import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildManifestPlan,
  encodeObjectKey,
  getOnlineManifestPath,
  getOutputManifestPath,
} from './upload-exam-images-to-oss.mjs';

test('encodeObjectKey keeps slashes and percent-encodes each path segment', () => {
  assert.equal(
    encodeObjectKey('历年试题/2020·高考数学真题/a b(1).png'),
    '%E5%8E%86%E5%B9%B4%E8%AF%95%E9%A2%98/2020%C2%B7%E9%AB%98%E8%80%83%E6%95%B0%E5%AD%A6%E7%9C%9F%E9%A2%98/a%20b(1).png',
  );
});

test('getOnlineManifestPath inserts .online before .json', () => {
  assert.equal(
    getOnlineManifestPath('/tmp/2020年高考数学试卷（北京）_资源清单.json'),
    '/tmp/2020年高考数学试卷（北京）_资源清单.online.json',
  );
});

test('getOutputManifestPath flattens online manifests into the requested directory', () => {
  assert.equal(
    getOutputManifestPath(
      '/repo/历年试题/2020/北京卷_切题/北京卷_资源清单.json',
      '/repo/data/papers',
    ),
    '/repo/data/papers/北京卷_资源清单.online.json',
  );
});

test('buildManifestPlan maps a local image to a stable public URL without changing other fields', async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), 'qisi-oss-plan-'));
  const manifestDirectory = path.join(rootPath, '2020·高考数学真题', '试卷_切题');
  const imagePath = path.join(manifestDirectory, '题目图片', '第 01 题.png');
  const manifestPath = path.join(manifestDirectory, '试卷_资源清单.json');
  await mkdir(path.dirname(imagePath), { recursive: true });
  await writeFile(imagePath, 'fixture');
  await writeFile(
    manifestPath,
    JSON.stringify({
      title: '测试试卷',
      resources: [{ image: '题目图片/第 01 题.png', width: 800 }],
    }),
  );

  const plan = await buildManifestPlan({
    manifestPath,
    rootPath,
    objectPrefix: '历年试题',
    publicBaseUrl: 'https://qisi-main.oss-cn-hangzhou.aliyuncs.com',
  });

  assert.equal(plan.uploads.length, 1);
  assert.equal(plan.uploads[0].localPath, imagePath);
  assert.equal(
    plan.uploads[0].objectKey,
    '历年试题/2020·高考数学真题/试卷_切题/题目图片/第 01 题.png',
  );
  assert.equal(
    plan.onlineManifest.resources[0].image,
    'https://qisi-main.oss-cn-hangzhou.aliyuncs.com/%E5%8E%86%E5%B9%B4%E8%AF%95%E9%A2%98/2020%C2%B7%E9%AB%98%E8%80%83%E6%95%B0%E5%AD%A6%E7%9C%9F%E9%A2%98/%E8%AF%95%E5%8D%B7_%E5%88%87%E9%A2%98/%E9%A2%98%E7%9B%AE%E5%9B%BE%E7%89%87/%E7%AC%AC%2001%20%E9%A2%98.png',
  );
  assert.equal(plan.onlineManifest.resources[0].width, 800);
});

test('buildManifestPlan rejects image paths that escape the exam root', async () => {
  const parentPath = await mkdtemp(path.join(os.tmpdir(), 'qisi-oss-escape-'));
  const rootPath = path.join(parentPath, '历年试题');
  const manifestPath = path.join(rootPath, '试卷_资源清单.json');
  await mkdir(rootPath);
  await writeFile(path.join(parentPath, 'outside.png'), 'fixture');
  await writeFile(
    manifestPath,
    JSON.stringify({ resources: [{ image: '../outside.png' }] }),
  );

  await assert.rejects(
    buildManifestPlan({
      manifestPath,
      rootPath,
      objectPrefix: '历年试题',
      publicBaseUrl: 'https://qisi-main.oss-cn-hangzhou.aliyuncs.com',
    }),
    /超出题库根目录/,
  );
});
