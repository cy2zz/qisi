import { Module, type DynamicModule } from '@nestjs/common';
import { TeacherController } from './teacher.controller.js';
import { TeacherService } from './teacher.service.js';
import { TEACHER_OPTIONS, TEACHER_STORE, type TeacherOptions, type TeacherStorePort } from './teacher.port.js';
/** Explicit composition required: cannot silently start with fake authorization/persistence. */
@Module({})
export class TeacherModule {
 static register(store: TeacherStorePort, options: TeacherOptions): DynamicModule {
  return { module: TeacherModule, controllers: [TeacherController], providers: [TeacherService, { provide: TEACHER_STORE, useValue: store }, { provide: TEACHER_OPTIONS, useValue: options }] };
 }
}
