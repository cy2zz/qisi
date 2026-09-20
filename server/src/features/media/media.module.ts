import { Module } from '@nestjs/common';
import { ModelModule } from '../../model/model.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { MediaController } from './media.controller.js';
import { HandwritingRecognitionService } from './handwriting-recognition.service.js';
import { MediaService } from './media.service.js';
import { PrivateMediaStorageService } from './private-media-storage.service.js';
import { QuestionImageLoader } from './question-image-loader.js';
import { QuestionImageRecognitionService } from './question-image-recognition.service.js';

@Module({
  imports: [AuthModule, ModelModule],
  controllers: [MediaController],
  providers: [
    HandwritingRecognitionService,
    MediaService,
    PrivateMediaStorageService,
    QuestionImageLoader,
    QuestionImageRecognitionService,
  ],
  exports: [
    MediaService,
    PrivateMediaStorageService,
    QuestionImageLoader,
    QuestionImageRecognitionService,
  ],
})
export class MediaModule {}
