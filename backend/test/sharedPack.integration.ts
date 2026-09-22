/* eslint-disable no-console */
import assert from 'node:assert';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

import { Asset, AssetSchema, AssetDocument } from '../src/models/asset.schema';
import { Collection, CollectionSchema, CollectionDocument } from '../src/models/collection.schema';
import { SharedPack, SharedPackSchema, SharedPackDocument } from '../src/models/sharedPack.schema';
import { PackClaim, PackClaimSchema, PackClaimDocument } from '../src/models/packClaim.schema';
import { SharedPackService } from '../src/services/sharedPack.service';
import { AssetStatus, AssetType, LicenseType, SharedPackStatus, UserRole } from '../src/types/enums';
import type { AuthUser, CreateSharedPackInput } from '../src/types/interfaces';

let mongod: MongoMemoryServer;
let service: SharedPackService;
let packModel: mongoose.Model<SharedPackDocument>;
let claimModel: mongoose.Model<PackClaimDocument>;
let assetModel: mongoose.Model<AssetDocument>;
let collectionModel: mongoose.Model<CollectionDocument>;
let collectionId: string;
let assetId: string;
let secondAssetId: string;

const creator: AuthUser = { id: 'creator-1', role: UserRole.Uploader };
const baseInput = (overrides: Partial<CreateSharedPackInput> = {}): CreateSharedPackInput => ({
  collectionId,
  assetIds: [assetId],
  claimCode: 'PACK01',
  totalCopies: 3,
  expiresAt: new Date(Date.now() + 86_400_000),
  ...overrides,
});

async function seedFixture() {
  const asset = await assetModel.create({
    title: '海报模板',
    description: 'desc',
    assetType: AssetType.Template,
    fileFormat: 'PSD',
    fileUrl: 'https://cdn/old.psd',
    fileSize: 100,
    uploaderId: 'creator-1',
    licenseType: LicenseType.CC_BY,
    status: AssetStatus.Published,
  });
  const second = await assetModel.create({
    title: '字体素材',
    description: 'desc',
    assetType: AssetType.Font,
    fileFormat: 'OTF',
    fileUrl: 'https://cdn/font.otf',
    fileSize: 200,
    uploaderId: 'creator-1',
    licenseType: LicenseType.Free,
    status: AssetStatus.Published,
  });
  assetId = asset._id.toString();
  secondAssetId = second._id.toString();
  const collection = await collectionModel.create({
    name: '我的收藏集',
    creatorId: 'creator-1',
    assetIds: [asset._id, second._id],
  });
  collectionId = collection._id.toString();
}

async function setup() {
  mongod = await MongoMemoryServer.create({ binary: { version: '7.0.14' } });
  await mongoose.connect(mongod.getUri());
  // 测试中绕过 HydratedDocument 与 Schema 泛型协变校验，运行时行为与生产注入一致
  const packM: any = mongoose.model(SharedPack.name, SharedPackSchema);
  const claimM: any = mongoose.model(PackClaim.name, PackClaimSchema);
  const collectionM: any = mongoose.model(Collection.name, CollectionSchema);
  const assetM: any = mongoose.model(Asset.name, AssetSchema);
  packModel = packM;
  claimModel = claimM;
  collectionModel = collectionM;
  assetModel = assetM;
  service = new SharedPackService(packM, claimM, collectionM, assetM);
  await seedFixture();
}

async function teardown() {
  await mongoose.disconnect();
  await mongod.stop();
}

async function caseCreateSnapshot() {
  // 使用独立素材，避免本用例的变更污染其他用例的共享 fixture
  const ownAsset = await assetModel.create({
    title: '将被冻结的素材',
    description: 'snapshot',
    assetType: AssetType.Image,
    fileFormat: 'PNG',
    fileUrl: 'https://cdn/freeze-old.png',
    fileSize: 100,
    uploaderId: 'creator-1',
    licenseType: LicenseType.CC_BY,
    status: AssetStatus.Published,
  });
  await collectionModel.findByIdAndUpdate(collectionId, {
    $addToSet: { assetIds: ownAsset._id },
  });
  const pack = await service.createPack(
    baseInput({ claimCode: 'SNAP01', assetIds: [ownAsset._id.toString()] }),
    creator,
  );
  assert.strictEqual(pack.assets.length, 1);
  assert.strictEqual(pack.assets[0].licenseType, LicenseType.CC_BY);
  assert.strictEqual(pack.assets[0].licenseVersion, 'CC_BY-2026.1');
  assert.strictEqual(pack.assets[0].fileUrl, 'https://cdn/freeze-old.png');

  // 收藏集随后增删素材 + 素材本身标题/许可/URL 变更
  await collectionModel.findByIdAndUpdate(collectionId, { $pull: { assetIds: ownAsset._id } });
  await assetModel.findByIdAndUpdate(ownAsset._id, {
    title: '被改名的素材',
    licenseType: LicenseType.Extended,
    fileUrl: 'https://cdn/freeze-new.png',
  });
  const refetched = await packModel.findById(pack._id);
  assert.strictEqual(refetched!.assets[0].title, '将被冻结的素材', '快照标题不可变');
  assert.strictEqual(refetched!.assets[0].licenseType, LicenseType.CC_BY, '快照许可不可变');
  assert.strictEqual(refetched!.assets[0].fileUrl, 'https://cdn/freeze-old.png', '快照URL不可变');
  assert.strictEqual(refetched!.assets.length, 1, '收藏集移除素材不影响旧包清单');
  console.log('✓ 快照冻结：收藏集/素材后续变更不影响旧包内容与许可');
}

async function caseValidation() {
  const otherCollection = await collectionModel.create({ name: '他人收藏集', creatorId: 'someone-else' });
  await assert.rejects(
    () => service.createPack(baseInput({ collectionId: otherCollection._id.toString() }), creator),
    /仅收藏集创建人/,
  );
  const draft = await assetModel.create({
    title: '草稿',
    description: '尚未发布',
    assetType: AssetType.Image,
    fileFormat: 'PNG',
    fileUrl: 'u',
    fileSize: 1,
    uploaderId: 'u',
    licenseType: LicenseType.Free,
    status: AssetStatus.Draft,
  });
  await assert.rejects(
    () =>
      service.createPack(
        baseInput({ claimCode: 'PACK02', assetIds: [draft._id.toString()] }),
        creator,
      ),
    /未发布/,
  );
  await assert.rejects(
    () => service.createPack(baseInput({ claimCode: 'bad code' }), creator),
    /领用码/,
  );
  await assert.rejects(
    () => service.createPack(baseInput({ totalCopies: 0 }), creator),
    /总领取份数/,
  );
  await assert.rejects(
    () => service.createPack(baseInput({ expiresAt: new Date(Date.now() - 1000) }), creator),
    /有效期/,
  );
  console.log('✓ 创建校验：权限 / 未发布素材 / 码格式 / 份数 / 过期时间');
}

async function caseClaimFlow() {
  const pack = await service.createPack(baseInput({ claimCode: 'FLOW01', totalCopies: 3 }), creator);
  const userA: AuthUser = { id: 'user-a', role: UserRole.Viewer };
  const first = await service.claim('flow01', userA); // 小写码归一化
  assert.strictEqual(first.repeated, false);
  assert.strictEqual(first.remainingCopies, 2);
  assert.strictEqual(first.assets.length, 1);

  const again = await service.claim('FLOW01', userA);
  assert.strictEqual(again.repeated, true, '重复领取标记 repeated');
  assert.strictEqual(again.claimId, first.claimId, '返回原领取记录');
  assert.strictEqual(again.remainingCopies, 2, '重复领取不重复计数');
  const claimCount = await claimModel.countDocuments({ packId: pack._id, claimantId: 'user-a' });
  assert.strictEqual(claimCount, 1);

  const userB: AuthUser = { id: 'user-b', role: UserRole.Viewer };
  const second = await service.claim('FLOW01', userB);
  assert.strictEqual(second.remainingCopies, 1);
  const userC: AuthUser = { id: 'user-c', role: UserRole.Viewer };
  const third = await service.claim('FLOW01', userC);
  assert.strictEqual(third.remainingCopies, 0);
  await assert.rejects(
    () => service.claim('FLOW01', { id: 'user-d', role: UserRole.Viewer }),
    /份数已用尽/,
  );

  // 创建人查看的份数与领取人剩余量一致
  const detail = await service.findOneForCreator(pack._id.toString(), creator);
  assert.strictEqual(detail.claimedCount, 3);
  assert.strictEqual(detail.totalCopies, 3);
  assert.strictEqual(detail.remainingCopies, 0);
  assert.strictEqual(detail.claims.length, 3);
  assert.strictEqual(third.remainingCopies, detail.remainingCopies, '两端剩余量必须一致');
  console.log('✓ 领取流程：幂等不计数、用尽拒绝、创建人份数与领取人剩余量一致');
}

async function caseConcurrentNoOversell() {
  const pack = await service.createPack(baseInput({ claimCode: 'RACE01', totalCopies: 5 }), creator);
  const users = Array.from({ length: 20 }, (_, i) => ({
    id: `racer-${i}`,
    role: UserRole.Viewer,
  })) as AuthUser[];
  const results = await Promise.allSettled(users.map((u) => service.claim('RACE01', u)));
  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');
  assert.strictEqual(fulfilled.length, 5, `成功 5 份，实际 ${fulfilled.length}`);
  assert.strictEqual(rejected.length, 15, `拒绝 15 份，实际 ${rejected.length}`);
  const stored = await packModel.findById(pack._id);
  assert.strictEqual(stored!.claimedCount, 5, 'claimedCount 不能超过总份数');
  const claimDocs = await claimModel.countDocuments({ packId: pack._id });
  assert.strictEqual(claimDocs, 5, '领取记录数与占用份数一致');
  fulfilled.forEach((r) => assert.ok(r.status === 'fulfilled' && r.value.remainingCopies >= 0));
  console.log('✓ 并发防超卖：20 账号并发抢 5 份，恰好 5 成功、计数不越界');
}

async function caseConcurrentSameUserIdempotent() {
  const pack = await service.createPack(baseInput({ claimCode: 'RACE02', totalCopies: 5 }), creator);
  const user: AuthUser = { id: 'same-user', role: UserRole.Viewer };
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => service.claim('RACE02', user)));
  const rejected = results.filter((r) => r.status === 'rejected');
  assert.strictEqual(rejected.length, 0, '同账号并发不应报错');
  const stored = await packModel.findById(pack._id);
  const claimDocs = await claimModel.countDocuments({ packId: pack._id, claimantId: 'same-user' });
  assert.strictEqual(claimDocs, 1, '同账号只有一条领取记录');
  assert.strictEqual(stored!.claimedCount, 1, '同账号并发只占用一份');
  console.log('✓ 同账号并发领取：唯一记录、仅占一份（幂等 + 补偿回退）');
}

async function caseExpiryAndRevoke() {
  const expiring = await service.createPack(
    baseInput({ claimCode: 'EXP01', totalCopies: 2, expiresAt: new Date(Date.now() + 30) }),
    creator,
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  await assert.rejects(
    () => service.claim('EXP01', { id: 'late-user', role: UserRole.Viewer }),
    /已过期/,
  );
  const afterExpiry = await packModel.findById(expiring._id);
  assert.strictEqual(afterExpiry!.claimedCount, 0, '过期拒绝不占份数');

  const revocable = await service.createPack(baseInput({ claimCode: 'REV01', totalCopies: 2 }), creator);
  await service.revoke(revocable._id.toString(), creator, '活动结束');
  await assert.rejects(
    () => service.claim('REV01', { id: 'late-user', role: UserRole.Viewer }),
    /已被撤销/,
  );
  const stored = await packModel.findById(revocable._id);
  assert.strictEqual(stored!.status, SharedPackStatus.Revoked);
  assert.ok(stored!.revokedAt);

  // 非创建人不能撤销
  await assert.rejects(
    () => service.revoke(revocable._id.toString(), { id: 'other', role: UserRole.Uploader }),
    /仅创建人/,
  );
  console.log('✓ 过期 / 撤销拒绝且不占份数，撤销权限受限');
}

async function caseInvalidCode() {
  await assert.rejects(
    () => service.claim('NOTEXIST', { id: 'x', role: UserRole.Viewer }),
    /领用码无效/,
  );
  console.log('✓ 无效领用码拒绝');
}

async function main() {
  await setup();
  await caseCreateSnapshot();
  await caseValidation();
  await caseClaimFlow();
  await caseConcurrentNoOversell();
  await caseConcurrentSameUserIdempotent();
  await caseExpiryAndRevoke();
  await caseInvalidCode();
  await teardown();
  console.log('\n全部集成验证通过 ✅');
}

main().catch((error) => {
  console.error('验证失败 ❌', error);
  process.exit(1);
});
