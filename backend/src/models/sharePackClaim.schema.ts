import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type SharePackClaimDocument = HydratedDocument<SharePackClaim>;

@Schema({ timestamps: true })
export class SharePackClaim {
  @Prop({ type: Types.ObjectId, ref: 'SharePack', required: true })
  packId!: Types.ObjectId;

  @Prop({ required: true })
  claimerId!: string;

  @Prop({ default: () => new Date() })
  claimedAt!: Date;
}

export const SharePackClaimSchema = SchemaFactory.createForClass(SharePackClaim);
// 同一账号对同一素材包只能存在一条领取记录，是幂等领取的硬约束
SharePackClaimSchema.index({ packId: 1, claimerId: 1 }, { unique: true });
