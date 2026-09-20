import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

const imageResourceSchema = z
  .object({
    height: z.number().int().positive(),
    image: z.url(),
    kind: z.enum(['intro', 'question', 'analysis']),
    label: z.string().min(1),
    number: z.number().int().positive().nullable(),
    originalImage: z.string().optional(),
    originalImageIntervals: z.array(z.tuple([z.number(), z.number()])).optional(),
    safeBreaks: z.array(z.number().nonnegative()),
    sourcePDF: z.string().optional(),
    sourceRegions: z.array(z.unknown()),
    width: z.number().int().positive(),
  })
  .passthrough();

const paperManifestSchema = z
  .object({
    layout: z.string().min(1),
    notes: z.array(z.string()),
    prefix: z.string().min(1),
    questionCount: z.number().int().positive(),
    resources: z.array(imageResourceSchema),
    sourcePDF: z.string().min(1),
    sourcePages: z.number().int().positive(),
    title: z.string().min(1),
    variant: z.string().min(1),
  })
  .strict();

type ImageResource = z.infer<typeof imageResourceSchema>;

export interface NormalizedPaperImage {
  height: number;
  label: string;
  objectKey: string;
  originalImage?: string;
  originalImageIntervals?: Array<[number, number]>;
  safeBreaks: number[];
  sourcePdf?: string;
  sourceRegions: unknown[];
  url: string;
  width: number;
}

export interface NormalizedPaperQuestion {
  analysisImage: NormalizedPaperImage | null;
  number: number;
  questionCode: string;
  questionImage: NormalizedPaperImage;
  status: 'ready' | 'needs_review';
}

export interface NormalizedPaper {
  examYear: number;
  introImage: NormalizedPaperImage | null;
  isOfficial: boolean;
  layout: string;
  notes: string[];
  paperCode: string;
  prefix: string;
  questions: NormalizedPaperQuestion[];
  region: string;
  session: string | null;
  sourceFile: string;
  sourcePages: number;
  sourcePdf: string;
  title: string;
  track: '文科' | '理科' | '综合';
  variant: string;
}

const CITY_OR_PROVINCE_NAMES = ['北京', '上海', '天津', '浙江', '江苏', '山东', '海南'];
const PAPER_VARIANTS = [
  '全国甲卷',
  '全国乙卷',
  '全国Ⅰ卷',
  '全国Ⅱ卷',
  '新高考Ⅰ卷',
  '新高考Ⅱ卷',
  '新课标Ⅰ卷',
  '新课标Ⅱ卷',
  '新课标Ⅲ卷',
  '新课标Ⅰ',
  '新课标Ⅱ',
  '新课标Ⅲ',
];

function normalizePaperVariant(value: string) {
  return /^新课标[ⅠⅡⅢ]$/.test(value) ? `${value}卷` : value;
}

function deriveRegion(title: string) {
  const cityOrProvince = CITY_OR_PROVINCE_NAMES.find((name) => title.includes(`（${name}`));
  if (cityOrProvince) return cityOrProvince;

  const paperVariant = PAPER_VARIANTS.find((name) => title.includes(`（${name}）`));
  if (paperVariant) return normalizePaperVariant(paperVariant);

  throw new Error(`Cannot derive region or paper variant from title: ${title}`);
}

function deriveSession(title: string) {
  if (title.includes('（春考）')) return '春考';
  if (title.includes('（秋考）')) return '秋考';
  if (title.includes('上海6月')) return '6月';
  return null;
}

function deriveTrack(title: string): NormalizedPaper['track'] {
  if (title.includes('（文）')) return '文科';
  if (title.includes('（理）')) return '理科';
  return '综合';
}

export function extractObjectKey(imageUrl: string) {
  const url = new URL(imageUrl);
  return decodeURIComponent(url.pathname.replace(/^\/+/, ''));
}

function normalizeImage(resource: ImageResource): NormalizedPaperImage {
  return {
    height: resource.height,
    label: resource.label,
    objectKey: extractObjectKey(resource.image),
    ...(resource.originalImage ? { originalImage: resource.originalImage } : {}),
    ...(resource.originalImageIntervals
      ? { originalImageIntervals: resource.originalImageIntervals }
      : {}),
    safeBreaks: resource.safeBreaks,
    ...(resource.sourcePDF ? { sourcePdf: resource.sourcePDF } : {}),
    sourceRegions: resource.sourceRegions,
    url: resource.image,
    width: resource.width,
  };
}

async function readPaperManifest(filePath: string, sourceFile: string): Promise<NormalizedPaper> {
  const parsedJson: unknown = JSON.parse(await readFile(filePath, 'utf8'));
  const manifest = paperManifestSchema.parse(parsedJson);
  const yearMatch = /^(\d{4})年/.exec(manifest.title);
  if (!yearMatch) throw new Error(`Cannot derive exam year from title: ${manifest.title}`);

  const questionResources = manifest.resources.filter(
    (resource): resource is ImageResource & { number: number } =>
      resource.kind === 'question' && resource.number !== null,
  );
  const analysisByNumber = new Map(
    manifest.resources
      .filter(
        (resource): resource is ImageResource & { number: number } =>
          resource.kind === 'analysis' && resource.number !== null,
      )
      .map((resource) => [resource.number, resource]),
  );

  if (questionResources.length !== manifest.questionCount) {
    throw new Error(
      `${sourceFile} declares ${manifest.questionCount} questions but contains ${questionResources.length}`,
    );
  }

  const seenNumbers = new Set<number>();
  const paperCode = manifest.title;
  const questions = questionResources
    .map((resource): NormalizedPaperQuestion => {
      if (seenNumbers.has(resource.number)) {
        throw new Error(`${sourceFile} contains duplicate question number ${resource.number}`);
      }
      seenNumbers.add(resource.number);
      const analysisResource = analysisByNumber.get(resource.number);
      return {
        analysisImage: analysisResource ? normalizeImage(analysisResource) : null,
        number: resource.number,
        questionCode: `${paperCode}#${String(resource.number).padStart(2, '0')}`,
        questionImage: normalizeImage(resource),
        status: analysisResource ? 'ready' : 'needs_review',
      };
    })
    .sort((left, right) => left.number - right.number);
  const introResource = manifest.resources.find((resource) => resource.kind === 'intro');

  return {
    examYear: Number(yearMatch[1]),
    introImage: introResource ? normalizeImage(introResource) : null,
    isOfficial: !manifest.title.includes('回忆版'),
    layout: manifest.layout,
    notes: manifest.notes,
    paperCode,
    prefix: manifest.prefix,
    questions,
    region: deriveRegion(manifest.title),
    session: deriveSession(manifest.title),
    sourceFile,
    sourcePages: manifest.sourcePages,
    sourcePdf: manifest.sourcePDF,
    title: manifest.title,
    track: deriveTrack(manifest.title),
    variant: manifest.variant,
  };
}

export async function loadPaperManifests(directory: string) {
  const fileNames = (await readdir(directory))
    .filter((fileName) => fileName.endsWith('.online.json'))
    .sort((left, right) => left.localeCompare(right, 'zh-CN'));

  const papers = await Promise.all(
    fileNames.map((fileName) => readPaperManifest(join(directory, fileName), fileName)),
  );
  const duplicatePaperCode = papers.find(
    (paper, index) => papers.findIndex((candidate) => candidate.paperCode === paper.paperCode) !== index,
  );
  if (duplicatePaperCode) throw new Error(`Duplicate paper code: ${duplicatePaperCode.paperCode}`);
  return papers;
}
