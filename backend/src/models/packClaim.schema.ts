import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PackClaimDocument = HydratedDocument<PackClaim>;

/**
 * 共享素材包领取记录。
 * (packId, claimantId) 唯一索引：同一账号对同一包只存在一条领取记录，
 * 数据库层面保证重复领取不重复计数，并兜底并发下的重复插入。
 */
@Schema({ timestamps: true })
export class PackClaim {
  @Prop({ type: Types.ObjectId, ref: 'SharedPack', required: true })
  packId!: Types.ObjectId;

  @Prop({ required: true })
  claimantId!: string;

  @Prop({ default: () => new Date() })
  claimedAt!: Date;
}

export const PackClaimSchema = SchemaFactory.createForClass(PackClaim);
PackClaimSchema.index({ packId: 1, claimantId: 1 }, { unique: true });
