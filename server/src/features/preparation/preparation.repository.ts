import { Inject, Injectable } from '@nestjs/common';
import { PacketSchema, type Packet } from '../../contracts/domain.schema.js';
import { DatabaseService } from '../../database/database.service.js';

export interface PreparationCacheRecord {
  readonly packet: Packet;
  readonly review: unknown;
  readonly status: 'needs_review' | 'ready';
}

export interface SavePreparationCacheInput extends PreparationCacheRecord {
  readonly configHash: string;
  readonly modelId: string;
  readonly problemHash: string;
  readonly promptVersion: string;
  readonly version: string;
}

export interface PreparationPacketStore {
  find(problemHash: string, version: string): Promise<PreparationCacheRecord | null>;
  save(input: SavePreparationCacheInput): Promise<void>;
}

function parseJson<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

function hashBuffer(value: string): Buffer {
  return Buffer.from(value, 'hex');
}

@Injectable()
export class PreparationRepository implements PreparationPacketStore {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async find(problemHash: string, version: string): Promise<PreparationCacheRecord | null> {
    const row = await this.database.client
      .selectFrom('packets')
      .select(['packet_json', 'review_json', 'status'])
      .where('problem_hash', '=', hashBuffer(problemHash))
      .where('version', '=', version)
      .executeTakeFirst();
    if (!row) return null;

    return {
      packet: PacketSchema.parse(parseJson(row.packet_json)),
      review: parseJson(row.review_json),
      status: row.status === 'ready' ? 'ready' : 'needs_review',
    };
  }

  async save(input: SavePreparationCacheInput): Promise<void> {
    const values = {
      config_hash: input.configHash,
      model_id: input.modelId,
      packet_json: JSON.stringify(input.packet),
      problem_hash: hashBuffer(input.problemHash),
      problem_id: input.packet.problem_id,
      prompt_version: input.promptVersion,
      review_json: JSON.stringify(input.review),
      status: input.status,
      version: input.version,
    };

    await this.database.client
      .insertInto('packets')
      .values(values)
      .onDuplicateKeyUpdate({
        config_hash: values.config_hash,
        model_id: values.model_id,
        packet_json: values.packet_json,
        problem_id: values.problem_id,
        prompt_version: values.prompt_version,
        review_json: values.review_json,
        status: values.status,
      })
      .execute();
  }
}
