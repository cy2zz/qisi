// 装配守卫：教学轮的路由必须真的存在，且 SUBMIT_TURN_DEPS 必须解析得出来。
//
// 这是「提供者不对 → Nest 启动失败 → 整个应用起不来」那条红线的守卫。
// 只断言 /api/health 是不够的：TutorService 的依赖若解析不出来，compile() 会直接抛错，
// 而路由若没接上，请求会得到 404 而不是控制器的任何响应。
//
// 为什么用非法 Origin：控制器第一句就是 Origin 比对，因此这一支不需要
// 鉴权、不需要数据库、不触碰任何会话——它恰好只能由「路由存在 + 服务已解析」满足。

import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { SUBMIT_TURN_DEPS, TutorService } from '../../src/features/tutor/tutor.service.js';

describe('装配守卫：教学轮已接入应用', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // 依赖图有错时这一句就会抛错——这正是要守住的东西。
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('TutorService 与其依赖可解析', () => {
    expect(app.get(TutorService)).toBeInstanceOf(TutorService);
    expect(app.get(SUBMIT_TURN_DEPS)).toBeDefined();
  });

  it('POST /api/tutor/turn 已存在：非法 Origin 得到 403 而不是 404', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/tutor/turn')
      .set('Origin', 'https://not-the-web-origin.example')
      .send({})
      .expect(403);

    expect(response.body).toMatchObject({ statusCode: 403 });
  });
});
