#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import {
  access,
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_BUCKET = 'qisi-main';
const DEFAULT_REGION = 'oss-cn-hangzhou';
const DEFAULT_PREFIX = '历年试题';
const DEFAULT_CONCURRENCY = 5;

export function encodeObjectKey(objectKey) {
  return objectKey.split('/').map(encodeURIComponent).join('/');
}

export function getOnlineManifestPath(manifestPath) {
  if (!manifestPath.endsWith('.json')) {
    throw new Error(`资源清单必须是 JSON 文件：${manifestPath}`);
  }

  return `${manifestPath.slice(0, -'.json'.length)}.online.json`;
}

export function getOutputManifestPath(manifestPath, outputDirectory) {
  return path.join(
    path.resolve(outputDirectory),
    path.basename(getOnlineManifestPath(manifestPath)),
  );
}

function assertInsideRoot(rootPath, candidatePath, label) {
  const relativePath = path.relative(rootPath, candidatePath);
  if (
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`${label}超出题库根目录：${candidatePath}`);
  }

  return relativePath;
}

function normalizeObjectPrefix(value) {
  const prefix = value.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
  if (!prefix || prefix.split('/').some((segment) => segment === '..')) {
    throw new Error(`OSS 对象前缀无效：${value}`);
  }
  return prefix;
}

function toObjectKey(objectPrefix, relativePath) {
  return [normalizeObjectPrefix(objectPrefix), ...relativePath.split(path.sep)].join('/');
}

export async function buildManifestPlan({
  manifestPath,
  rootPath,
  objectPrefix,
  publicBaseUrl,
}) {
  const absoluteManifestPath = path.resolve(manifestPath);
  const absoluteRootPath = path.resolve(rootPath);
  assertInsideRoot(absoluteRootPath, absoluteManifestPath, '资源清单');

  let manifest;
  try {
    manifest = JSON.parse(await readFile(absoluteManifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`无法读取资源清单 ${absoluteManifestPath}：${error.message}`, {
      cause: error,
    });
  }

  if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.resources)) {
    throw new Error(`资源清单缺少 resources 数组：${absoluteManifestPath}`);
  }

  const uploads = [];
  const onlineResources = [];
  for (const [index, resource] of manifest.resources.entries()) {
    if (!resource || typeof resource !== 'object' || Array.isArray(resource)) {
      throw new Error(`resources[${index}] 不是对象：${absoluteManifestPath}`);
    }
    if (typeof resource.image !== 'string' || resource.image.length === 0) {
      throw new Error(`resources[${index}].image 不是非空字符串：${absoluteManifestPath}`);
    }
    if (/^[a-z][a-z\d+.-]*:/i.test(resource.image) || path.isAbsolute(resource.image)) {
      throw new Error(`resources[${index}].image 必须是本地相对路径：${resource.image}`);
    }

    const localPath = path.resolve(path.dirname(absoluteManifestPath), resource.image);
    const relativePath = assertInsideRoot(absoluteRootPath, localPath, '图片路径');
    const imageStat = await stat(localPath).catch(() => null);
    if (!imageStat?.isFile()) {
      throw new Error(`图片文件不存在：${localPath}`);
    }

    const objectKey = toObjectKey(objectPrefix, relativePath);
    const publicUrl = `${publicBaseUrl.replace(/\/$/, '')}/${encodeObjectKey(objectKey)}`;
    uploads.push({ localPath, objectKey, publicUrl });
    onlineResources.push({ ...resource, image: publicUrl });
  }

  return {
    manifestPath: absoluteManifestPath,
    outputPath: getOnlineManifestPath(absoluteManifestPath),
    onlineManifest: { ...manifest, resources: onlineResources },
    uploads,
  };
}

async function findManifestPaths(inputPath) {
  const inputStat = await stat(inputPath).catch(() => null);
  if (!inputStat) {
    throw new Error(`输入路径不存在：${inputPath}`);
  }
  if (inputStat.isFile()) {
    return [inputPath];
  }
  if (!inputStat.isDirectory()) {
    throw new Error(`输入路径既不是文件也不是目录：${inputPath}`);
  }

  const manifests = [];
  async function walk(directoryPath) {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
      } else if (
        entry.isFile() &&
        entry.name.endsWith('_资源清单.json') &&
        !entry.name.endsWith('.online.json')
      ) {
        manifests.push(entryPath);
      }
    }
  }

  await walk(inputPath);
  return manifests.sort((left, right) => left.localeCompare(right, 'zh-CN'));
}

function parseArguments(argv) {
  const options = {
    concurrency: DEFAULT_CONCURRENCY,
    inputPath: DEFAULT_PREFIX,
    objectPrefix: DEFAULT_PREFIX,
    outputDirectory: null,
    overwrite: false,
    rootPath: null,
    upload: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--upload') {
      options.upload = true;
    } else if (argument === '--overwrite') {
      options.overwrite = true;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else if (
      ['--input', '--root', '--prefix', '--output-dir', '--concurrency'].includes(argument)
    ) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${argument} 缺少参数值`);
      }
      index += 1;
      if (argument === '--input') options.inputPath = value;
      if (argument === '--root') options.rootPath = value;
      if (argument === '--prefix') options.objectPrefix = value;
      if (argument === '--output-dir') options.outputDirectory = value;
      if (argument === '--concurrency') options.concurrency = Number(value);
    } else {
      throw new Error(`未知参数：${argument}`);
    }
  }

  if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 20) {
    throw new Error('--concurrency 必须是 1 到 20 的整数');
  }
  normalizeObjectPrefix(options.objectPrefix);
  return options;
}

function printHelp() {
  console.log(`用法：
  node scripts/upload-exam-images-to-oss.mjs [选项]

默认只预演，不上传、不写文件。增加 --upload 后才会上传，并在全部图片验证成功后生成 .online.json。

选项：
  --input <路径>        单个资源清单或包含资源清单的目录（默认：历年试题）
  --root <路径>         题库根目录（默认：目录输入本身，文件输入时为 ./历年试题）
  --prefix <对象前缀>  OSS 对象前缀（默认：历年试题）
  --output-dir <目录>   将所有 .online.json 平铺写入指定目录
  --concurrency <数量>  并发上传数 1-20（默认：5）
  --upload              执行上传并生成 .online.json
  --overwrite           允许覆盖 OSS 中同名但内容不同的对象
  --help                显示帮助

凭据优先从本机忽略的 .env.oss.private 读取，其次从 .env.oss.local 或当前环境读取：
  ALIYUN_OSS_ACCESS_KEY_ID
  ALIYUN_OSS_ACCESS_KEY_SECRET
  ALIYUN_OSS_STS_TOKEN（使用临时凭据时可选）
  ALIYUN_OSS_BUCKET（默认：qisi-main）
  ALIYUN_OSS_REGION（默认：oss-cn-hangzhou）
  ALIYUN_OSS_PUBLIC_BASE_URL（绑定自定义域名时可选）`);
}

async function md5File(filePath) {
  const hash = createHash('md5');
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

function normalizeEtag(value) {
  return typeof value === 'string' ? value.replaceAll('"', '').toLowerCase() : null;
}

async function getRemoteEtag(client, objectKey) {
  try {
    const result = await client.head(objectKey);
    return normalizeEtag(result?.res?.headers?.etag);
  } catch (error) {
    if (error?.status === 404 || error?.code === 'NoSuchKey') return null;
    throw error;
  }
}

async function uploadOne({ client, item, overwrite }) {
  const localEtag = await md5File(item.localPath);
  const remoteEtag = await getRemoteEtag(client, item.objectKey);
  let action = 'skipped';

  if (remoteEtag !== localEtag) {
    if (remoteEtag && !overwrite) {
      throw new Error(
        `OSS 已存在同名但内容不同的对象；确认后使用 --overwrite：${item.objectKey}`,
      );
    }
    await client.put(item.objectKey, item.localPath, {
      headers: { 'Cache-Control': 'public, max-age=86400' },
    });
    action = remoteEtag ? 'overwritten' : 'uploaded';
  }

  await client.putACL(item.objectKey, 'public-read');
  const response = await fetch(item.publicUrl, { method: 'HEAD', redirect: 'follow' });
  if (!response.ok) {
    throw new Error(
      `对象已上传但匿名访问失败（HTTP ${response.status}），请检查“阻止公共访问”和对象 ACL：${item.publicUrl}`,
    );
  }

  return action;
}

async function mapWithConcurrency(items, concurrency, worker) {
  let cursor = 0;
  const results = new Array(items.length);
  async function runWorker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runWorker));
  return results;
}

async function writeManifest(plan) {
  await mkdir(path.dirname(plan.outputPath), { recursive: true });
  const temporaryPath = `${plan.outputPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(plan.onlineManifest, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  await rename(temporaryPath, plan.outputPath);
}

function loadLocalEnvironment() {
  const envPaths = [path.resolve('.env.oss.private'), path.resolve('.env.oss.local')];
  for (const envPath of envPaths) {
    if (existsSync(envPath)) {
      process.loadEnvFile(envPath);
      return;
    }
  }
}

function getCredential(name, fallbackName) {
  return process.env[name] || process.env[fallbackName];
}

async function createOssClient({ bucket, region }) {
  const accessKeyId = getCredential('ALIYUN_OSS_ACCESS_KEY_ID', 'ALIBABA_CLOUD_ACCESS_KEY_ID');
  const accessKeySecret = getCredential(
    'ALIYUN_OSS_ACCESS_KEY_SECRET',
    'ALIBABA_CLOUD_ACCESS_KEY_SECRET',
  );
  const stsToken = getCredential('ALIYUN_OSS_STS_TOKEN', 'ALIBABA_CLOUD_SECURITY_TOKEN');
  if (!accessKeyId || !accessKeySecret) {
    throw new Error('缺少 OSS 凭据，请配置 ALIYUN_OSS_ACCESS_KEY_ID 和 ALIYUN_OSS_ACCESS_KEY_SECRET');
  }

  const { default: OSS } = await import('ali-oss');
  return new OSS({
    accessKeyId,
    accessKeySecret,
    bucket,
    region,
    ...(stsToken ? { stsToken } : {}),
  });
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  loadLocalEnvironment();
  const inputPath = path.resolve(options.inputPath);
  const inputStat = await stat(inputPath).catch(() => null);
  const rootPath = path.resolve(
    options.rootPath || (inputStat?.isDirectory() ? inputPath : DEFAULT_PREFIX),
  );
  await access(rootPath);

  const bucket = process.env.ALIYUN_OSS_BUCKET || DEFAULT_BUCKET;
  const region = process.env.ALIYUN_OSS_REGION || DEFAULT_REGION;
  const publicBaseUrl =
    process.env.ALIYUN_OSS_PUBLIC_BASE_URL || `https://${bucket}.${region}.aliyuncs.com`;
  const manifestPaths = await findManifestPaths(inputPath);
  if (manifestPaths.length === 0) {
    throw new Error(`没有找到 *_资源清单.json：${inputPath}`);
  }

  const plans = [];
  for (const manifestPath of manifestPaths) {
    const plan = await buildManifestPlan({
      manifestPath,
      objectPrefix: options.objectPrefix,
      publicBaseUrl,
      rootPath,
    });
    if (options.outputDirectory) {
      plan.outputPath = getOutputManifestPath(manifestPath, options.outputDirectory);
    }
    plans.push(plan);
  }

  const manifestByOutputPath = new Map();
  for (const plan of plans) {
    const existingManifest = manifestByOutputPath.get(plan.outputPath);
    if (existingManifest) {
      throw new Error(
        `两个资源清单会写入同一个输出文件：${existingManifest}；${plan.manifestPath}`,
      );
    }
    manifestByOutputPath.set(plan.outputPath, plan.manifestPath);
  }

  const uploadsByObjectKey = new Map();
  for (const upload of plans.flatMap((plan) => plan.uploads)) {
    const existing = uploadsByObjectKey.get(upload.objectKey);
    if (existing && existing.localPath !== upload.localPath) {
      throw new Error(`两个本地文件映射到同一个 OSS 对象：${upload.objectKey}`);
    }
    uploadsByObjectKey.set(upload.objectKey, upload);
  }
  const uploads = [...uploadsByObjectKey.values()];

  console.log(`资源清单：${plans.length}`);
  console.log(`唯一图片：${uploads.length}`);
  console.log(`OSS 目标：${publicBaseUrl}/${encodeObjectKey(normalizeObjectPrefix(options.objectPrefix))}/`);
  if (!options.upload) {
    console.log('预演完成：未上传、未写入文件。增加 --upload 后执行。');
    return;
  }

  const client = await createOssClient({ bucket, region });
  const actions = await mapWithConcurrency(uploads, options.concurrency, async (item, index) => {
    const action = await uploadOne({ client, item, overwrite: options.overwrite });
    console.log(`[${index + 1}/${uploads.length}] ${action}: ${item.objectKey}`);
    return action;
  });

  for (const plan of plans) await writeManifest(plan);
  const counts = Object.groupBy(actions, (action) => action);
  console.log(
    `完成：上传 ${counts.uploaded?.length || 0}，覆盖 ${counts.overwritten?.length || 0}，跳过 ${counts.skipped?.length || 0}；生成 ${plans.length} 份 .online.json。`,
  );
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
