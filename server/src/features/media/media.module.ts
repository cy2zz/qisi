import { Module } from '@nestjs/common';
import { ModelModule } from '../../model/model.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { MediaController } from './media.controller.js';
import { QuestionImageLoader } from './question-image-loader.js';
import { QuestionImageRecognitionService } from './question-image-recognition.service.js';

@Module({
  imports: [AuthModule, ModelModule],
  controllers: [MediaController],
  providers: [QuestionImageLoader, QuestionImageRecognitionService],
  exports: [QuestionImageLoader, QuestionImageRecognitionService],
})
export class MediaModule {}
