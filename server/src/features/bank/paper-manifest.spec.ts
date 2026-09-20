import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractObjectKey, loadPaperManifests } from './paper-manifest.js';

describe('paper manifest importer', () => {
  it('normalizes every online paper manifest without dropping a question', async () => {
    const papers = await loadPaperManifests(resolve(process.cwd(), '../data/papers'));

    expect(papers).toHaveLength(53);
    expect(papers.reduce((total, paper) => total + paper.questions.length, 0)).toBe(1151);
    expect(new Set(papers.map((paper) => paper.paperCode)).size).toBe(53);
    expect(new Set(papers.flatMap((paper) => paper.questions.map((question) => question.questionCode))).size).toBe(
      1151,
    );
  });

  it('derives student-facing filter fields from paper titles', async () => {
    const papers = await loadPaperManifests(resolve(process.cwd(), '../data/papers'));
    const beijing = papers.find((paper) => paper.title === '2020年高考数学试卷（北京）');
    const national = papers.find((paper) => paper.title === '2024年高考数学试卷（文）（全国甲卷）');
    const shanghai = papers.find(
      (paper) => paper.title === '2024年高考数学试卷（上海）（秋考）（回忆版）',
    );

    expect(beijing).toMatchObject({ examYear: 2020, region: '北京', track: '综合' });
    expect(national).toMatchObject({ examYear: 2024, region: '全国甲卷', track: '文科' });
    expect(shanghai).toMatchObject({ examYear: 2024, region: '上海', session: '秋考' });
  });

  it('keeps question and analysis images paired while deriving decoded OSS object keys', async () => {
    const papers = await loadPaperManifests(resolve(process.cwd(), '../data/papers'));
    const paper = papers.find((item) => item.title === '2020年高考数学试卷（北京）');
    const firstQuestion = paper?.questions[0];

    expect(firstQuestion).toMatchObject({ number: 1, status: 'ready' });
    expect(firstQuestion?.questionImage.url).toContain('oss-cn-hangzhou.aliyuncs.com');
    expect(firstQuestion?.analysisImage?.url).toContain('oss-cn-hangzhou.aliyuncs.com');
    expect(firstQuestion?.questionImage.objectKey).toContain('历年试题/2020·高考数学真题');
    expect(extractObjectKey(firstQuestion?.questionImage.url ?? '')).toBe(
      firstQuestion?.questionImage.objectKey,
    );
  });
});
