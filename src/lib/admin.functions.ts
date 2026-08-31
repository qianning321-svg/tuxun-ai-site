import { createServerFn } from "@tanstack/react-start";

type Input = Record<string, any>;

const inputValidator = (data: unknown): Input => (data && typeof data === "object" ? data as Input : {});

export const checkIsAdmin = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { checkIsAdmin } = await import("@/lib/admin.server");
    return checkIsAdmin(data);
  });

export const verifyAdminAccessPassword = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { verifyAdminAccessPassword } = await import("@/lib/admin.server");
    return verifyAdminAccessPassword(data);
  });

export const founderGetAccessPassword = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { founderGetAccessPassword } = await import("@/lib/admin.server");
    return founderGetAccessPassword(data);
  });

export const founderSetAccessPassword = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { founderSetAccessPassword } = await import("@/lib/admin.server");
    return founderSetAccessPassword(data);
  });

export const adminGetAnalytics = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { adminGetAnalytics } = await import("@/lib/admin.server");
    return adminGetAnalytics(data);
  });

export const adminListUsers = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { adminListUsers } = await import("@/lib/admin.server");
    return adminListUsers(data);
  });

export const adminGetUserCreditUsageLogs = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { adminGetUserCreditUsageLogs } = await import("@/lib/admin.server");
    return adminGetUserCreditUsageLogs(data);
  });

export const adminAdjustCredits = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { adminAdjustCredits } = await import("@/lib/admin.server");
    return adminAdjustCredits(data);
  });

export const adminBanUser = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { adminBanUser } = await import("@/lib/admin.server");
    return adminBanUser(data);
  });

export const adminDeleteUser = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { adminDeleteUser } = await import("@/lib/admin.server");
    return adminDeleteUser(data);
  });

export const adminResetPassword = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { adminResetPassword } = await import("@/lib/admin.server");
    return adminResetPassword(data);
  });

export const listActiveAds = createServerFn({ method: "GET" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { listActiveAds } = await import("@/lib/admin.server");
    return listActiveAds(data);
  });

export const adminListAds = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { adminListAds } = await import("@/lib/admin.server");
    return adminListAds(data);
  });

export const adminUpsertAd = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { adminUpsertAd } = await import("@/lib/admin.server");
    return adminUpsertAd(data);
  });

export const adminDeleteAd = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { adminDeleteAd } = await import("@/lib/admin.server");
    return adminDeleteAd(data);
  });

export const listAnnouncements = createServerFn({ method: "GET" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { listAnnouncements } = await import("@/lib/admin.server");
    return listAnnouncements(data);
  });

export const adminListAnnouncements = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { adminListAnnouncements } = await import("@/lib/admin.server");
    return adminListAnnouncements(data);
  });

export const adminUpsertAnnouncement = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { adminUpsertAnnouncement } = await import("@/lib/admin.server");
    return adminUpsertAnnouncement(data);
  });

export const adminDeleteAnnouncement = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { adminDeleteAnnouncement } = await import("@/lib/admin.server");
    return adminDeleteAnnouncement(data);
  });

export const listVisibleRechargePackages = createServerFn({ method: "GET" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { listVisibleRechargePackages } = await import("@/lib/admin.server");
    return listVisibleRechargePackages(data);
  });

export const listAdminRechargePackages = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { listAdminRechargePackages } = await import("@/lib/admin.server");
    return listAdminRechargePackages(data);
  });

export const upsertAdminRechargePackage = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { upsertAdminRechargePackage } = await import("@/lib/admin.server");
    return upsertAdminRechargePackage(data);
  });

export const hideAdminRechargePackage = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { hideAdminRechargePackage } = await import("@/lib/admin.server");
    return hideAdminRechargePackage(data);
  });

export const deleteAdminRechargePackage = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { deleteAdminRechargePackage } = await import("@/lib/admin.server");
    return deleteAdminRechargePackage(data);
  });

export const adminListRedeemCodes = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { adminListRedeemCodes } = await import("@/lib/admin.server");
    return adminListRedeemCodes(data);
  });

export const adminGenerateRedeemCodes = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { adminGenerateRedeemCodes } = await import("@/lib/admin.server");
    return adminGenerateRedeemCodes(data);
  });

export const adminUpdateRedeemCodeStatus = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { adminUpdateRedeemCodeStatus } = await import("@/lib/admin.server");
    return adminUpdateRedeemCodeStatus(data);
  });

export const adminDeleteRedeemCode = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { adminDeleteRedeemCode } = await import("@/lib/admin.server");
    return adminDeleteRedeemCode(data);
  });

export const adminClearDisabledRedeemCodes = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { adminClearDisabledRedeemCodes } = await import("@/lib/admin.server");
    return adminClearDisabledRedeemCodes(data);
  });

export const redeemCode = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { redeemCode } = await import("@/lib/admin.server");
    return redeemCode(data);
  });

export const listModelsConfig = createServerFn({ method: "GET" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { listModelsConfig } = await import("@/lib/admin.server");
    return listModelsConfig(data);
  });

export const adminListModelsConfig = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { adminListModelsConfig } = await import("@/lib/admin.server");
    return adminListModelsConfig(data);
  });

export const adminUpdateModelPrice = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { adminUpdateModelPrice } = await import("@/lib/admin.server");
    return adminUpdateModelPrice(data);
  });

export const adminUpdateModel = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { adminUpdateModel } = await import("@/lib/admin.server");
    return adminUpdateModel(data);
  });

export const adminCreateModel = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { adminCreateModel } = await import("@/lib/admin.server");
    return adminCreateModel(data);
  });

export const adminDeleteModel = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { adminDeleteModel } = await import("@/lib/admin.server");
    return adminDeleteModel(data);
  });

export const adminGetProviderConfigurationStatuses = createServerFn({ method: "GET" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { adminGetProviderConfigurationStatuses } = await import("@/lib/admin.server");
    return adminGetProviderConfigurationStatuses(data);
  });

export const adminListProviderCredentials = createServerFn({ method: "GET" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { adminListProviderCredentials } = await import("@/lib/admin.server");
    return adminListProviderCredentials(data);
  });

export const adminUpsertProviderCredential = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { adminUpsertProviderCredential } = await import("@/lib/admin.server");
    return adminUpsertProviderCredential(data);
  });

export const adminClearProviderCredential = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { adminClearProviderCredential } = await import("@/lib/admin.server");
    return adminClearProviderCredential(data);
  });

export const adminGetGlobalConfig = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { adminGetGlobalConfig } = await import("@/lib/admin.server");
    return adminGetGlobalConfig(data);
  });

export const getGlobalConfig = createServerFn({ method: "GET" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { getGlobalConfig } = await import("@/lib/admin.server");
    return getGlobalConfig(data);
  });

export const adminUpdateGlobalConfig = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { adminUpdateGlobalConfig } = await import("@/lib/admin.server");
    return adminUpdateGlobalConfig(data);
  });

export const getContactInfo = createServerFn({ method: "GET" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { getContactInfo } = await import("@/lib/admin.server");
    return getContactInfo(data);
  });

export const adminGetContactInfo = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { adminGetContactInfo } = await import("@/lib/admin.server");
    return adminGetContactInfo(data);
  });

export const adminSetContactInfo = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { adminSetContactInfo } = await import("@/lib/admin.server");
    return adminSetContactInfo(data);
  });

export const listStyleTemplates = createServerFn({ method: "GET" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { listStyleTemplates } = await import("@/lib/admin.server");
    return listStyleTemplates(data);
  });

export const adminListStyleTemplates = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { adminListStyleTemplates } = await import("@/lib/admin.server");
    return adminListStyleTemplates(data);
  });

export const adminCreateStyleTemplate = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { adminCreateStyleTemplate } = await import("@/lib/admin.server");
    return adminCreateStyleTemplate(data);
  });

export const adminUpdateStyleTemplate = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { adminUpdateStyleTemplate } = await import("@/lib/admin.server");
    return adminUpdateStyleTemplate(data);
  });

export const adminDeleteStyleTemplate = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { adminDeleteStyleTemplate } = await import("@/lib/admin.server");
    return adminDeleteStyleTemplate(data);
  });

export const listAdminUsers = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { listAdminUsers } = await import("@/lib/admin.server");
    return listAdminUsers(data);
  });

export const addAdminUserByEmail = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { addAdminUserByEmail } = await import("@/lib/admin.server");
    return addAdminUserByEmail(data);
  });

export const updateAdminUserRole = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { updateAdminUserRole } = await import("@/lib/admin.server");
    return updateAdminUserRole(data);
  });

export const removeAdminUser = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { removeAdminUser } = await import("@/lib/admin.server");
    return removeAdminUser(data);
  });

export const resetAdminUserPassword = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { resetAdminUserPassword } = await import("@/lib/admin.server");
    return resetAdminUserPassword(data);
  });

export const founderListAdmins = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { founderListAdmins } = await import("@/lib/admin.server");
    return founderListAdmins(data);
  });

export const founderAddAdmin = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { founderAddAdmin } = await import("@/lib/admin.server");
    return founderAddAdmin(data);
  });

export const founderRemoveAdmin = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { founderRemoveAdmin } = await import("@/lib/admin.server");
    return founderRemoveAdmin(data);
  });

export const adminGetSystemPrompt = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { adminGetSystemPrompt } = await import("@/lib/admin.server");
    return adminGetSystemPrompt(data);
  });

export const adminSetSystemPrompt = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { adminSetSystemPrompt } = await import("@/lib/admin.server");
    return adminSetSystemPrompt(data);
  });

export const consumeGeneration = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { consumeGeneration } = await import("@/lib/admin.server");
    return consumeGeneration(data);
  });

export const getMyGenerationHistory = createServerFn({ method: "GET" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { getMyGenerationHistory } = await import("@/lib/admin.server");
    return getMyGenerationHistory(data);
  });

export const getMyGenerationTasks = createServerFn({ method: "GET" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { getMyGenerationTasks } = await import("@/lib/admin.server");
    return getMyGenerationTasks(data);
  });

export const createGenerationTask = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { createGenerationTask } = await import("@/lib/admin.server");
    return createGenerationTask(data);
  });

export const cancelMyQueuedGenerationTasks = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { cancelMyQueuedGenerationTasks } = await import("@/lib/admin.server");
    return cancelMyQueuedGenerationTasks(data);
  });

export const cancelGenerationTask = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { cancelGenerationTask } = await import("@/lib/admin.server");
    return cancelGenerationTask(data);
  });

export const startGenerationTask = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { startGenerationTask } = await import("@/lib/admin.server");
    return startGenerationTask(data);
  });

export const pollGenerationTask = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { pollGenerationTask } = await import("@/lib/admin.server");
    return pollGenerationTask(data);
  });

export const generateImage = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { generateImage } = await import("@/lib/admin.server");
    return generateImage(data);
  });

export const checkImageStatus = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { checkImageStatus } = await import("@/lib/admin.server");
    return checkImageStatus(data);
  });

export const generateRandomPrompt = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { generateRandomPrompt } = await import("@/lib/admin.server");
    return generateRandomPrompt(data);
  });

export const adminTestModel = createServerFn({ method: "POST" })
  .inputValidator(inputValidator)
  .handler(async ({ data }: { data: Input }) => {
    const { adminTestModel } = await import("@/lib/admin.server");
    return adminTestModel(data);
  });

export const redeemCoupon = redeemCode;
export const adminListCoupons = adminListRedeemCodes;
export const adminDeleteCoupon = adminDeleteRedeemCode;
export const adminGenerateCoupons = adminGenerateRedeemCodes;
