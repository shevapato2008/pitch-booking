import type {
  VenueOnboardingApplication,
  VenueOnboardingCandidate,
  VenueOnboardingEvidenceKind,
  VenueOnboardingPage,
  VenueOnboardingUploadIntent,
} from "../domain/venue-onboarding";

export interface VenueOnboardingIdentity {
  readonly userId: string;
  readonly maskedPhone: string | null;
  readonly contactName: string | null;
}

export interface VenueOnboardingClaimInput {
  readonly venueId: string;
  readonly contactName: string;
  readonly evidence: Readonly<Record<"MANAGEMENT_AUTHORIZATION" | "VENUE_EXTERIOR", string>>;
}

export interface VenueOnboardingCreateInput {
  readonly name: string;
  readonly address: string;
  readonly districtCode: string;
  readonly districtName: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly contactName: string;
  readonly evidence: Readonly<Record<VenueOnboardingEvidenceKind, string>>;
}

export interface VenueOnboardingDataSource {
  login(): Promise<VenueOnboardingIdentity>;
  authorizePhone(rawDetail: unknown): Promise<{ readonly maskedPhone: string }>;
  searchCandidates(query: string, cursor?: string): Promise<VenueOnboardingPage<VenueOnboardingCandidate>>;
  listApplications(cursor?: string): Promise<VenueOnboardingPage<VenueOnboardingApplication>>;
  createUploadIntent(kind: VenueOnboardingEvidenceKind, idempotencyKey: string): Promise<VenueOnboardingUploadIntent>;
  completeEvidence(evidenceId: string, idempotencyKey: string): Promise<{ readonly evidenceId: string; readonly status: "COMPLETED" }>;
  submitClaim(input: VenueOnboardingClaimInput, idempotencyKey: string): Promise<VenueOnboardingApplication>;
  submitCreate(input: VenueOnboardingCreateInput, idempotencyKey: string): Promise<VenueOnboardingApplication>;
}

export interface VenueOnboardingLocalEvidence {
  readonly tempFilePath: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly byteSize: number;
}

export interface VenueOnboardingEvidenceCapability {
  choose(kind: VenueOnboardingEvidenceKind): Promise<VenueOnboardingLocalEvidence>;
  upload(file: VenueOnboardingLocalEvidence, intent: VenueOnboardingUploadIntent): Promise<void>;
  abortAll?(): void;
}

let dataSource: VenueOnboardingDataSource | undefined;
let evidenceCapability: VenueOnboardingEvidenceCapability | undefined;
let keySequence = 0;

export function registerVenueOnboardingDataSource(source: VenueOnboardingDataSource): void {
  dataSource = source;
}

export function getVenueOnboardingDataSource(): VenueOnboardingDataSource {
  if (!dataSource) throw new Error("VENUE_ONBOARDING_DATA_SOURCE_NOT_CONFIGURED");
  return dataSource;
}

export function getVenueOnboardingDataSourceOrUndefined(): VenueOnboardingDataSource | undefined {
  return dataSource;
}

export function registerVenueOnboardingEvidenceCapability(capability: VenueOnboardingEvidenceCapability): void {
  evidenceCapability = capability;
}

export function getVenueOnboardingEvidenceCapability(): VenueOnboardingEvidenceCapability {
  if (!evidenceCapability) throw new Error("VENUE_ONBOARDING_EVIDENCE_CAPABILITY_NOT_CONFIGURED");
  return evidenceCapability;
}

export function getVenueOnboardingEvidenceCapabilityOrUndefined(): VenueOnboardingEvidenceCapability | undefined {
  return evidenceCapability;
}

export function createOnboardingIdempotencyKey(scope: string): string {
  keySequence += 1;
  return `${scope}-${Date.now().toString(36)}-${keySequence.toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function createWeChatVenueOnboardingEvidenceCapability(): VenueOnboardingEvidenceCapability {
  const activeUploads = new Set<{ abort(code?: string): void }>();
  return {
    choose(_kind) {
      return choosePhoto();
    },
    upload(file, intent) {
      return new Promise<void>((resolve, reject) => {
        let settled = false;
        const controller: { task?: { abort(): void }; timeout?: ReturnType<typeof setTimeout> } = {};
        const finish = (complete: () => void) => {
          if (settled) return;
          settled = true;
          if (controller.timeout !== undefined) clearTimeout(controller.timeout);
          activeUploads.delete(activeUpload);
          complete();
        };
        const activeUpload = {
          abort(code = "OSS_UPLOAD_ABORTED") {
            if (settled) return;
            finish(() => reject(new Error(code)));
            controller.task?.abort();
          },
        };
        activeUploads.add(activeUpload);
        controller.timeout = setTimeout(() => activeUpload.abort("OSS_UPLOAD_TIMEOUT"), 15_000);
        controller.task = wx.uploadFile({
          url: intent.postPolicy.url,
          filePath: file.tempFilePath,
          name: "file",
          formData: { ...intent.postPolicy.fields },
          success(result) {
            if (result.statusCode >= 200 && result.statusCode < 300) finish(resolve);
            else finish(() => reject(new Error("OSS_UPLOAD_REJECTED")));
          },
          fail() { finish(() => reject(new Error("OSS_UPLOAD_FAILED"))); },
        });
      });
    },
    abortAll() {
      for (const activeUpload of [...activeUploads]) activeUpload.abort();
    },
  };
}

export function resetVenueOnboardingBindingsForTesting(): void {
  dataSource = undefined;
  evidenceCapability = undefined;
  keySequence = 0;
}

function choosePhoto(): Promise<VenueOnboardingLocalEvidence> {
  return new Promise((resolve, reject) => {
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      success(result) {
        const file = result.tempFiles[0];
        if (!file) { reject(new Error("EVIDENCE_NOT_SELECTED")); return; }
        const filename = file.tempFilePath.split("/").pop() || "venue-evidence.jpg";
        resolve({
          tempFilePath: file.tempFilePath,
          filename,
          mimeType: inferMime(filename, file.fileType),
          byteSize: file.size,
        });
      },
      fail(result) { reject(new Error(result.errMsg || "EVIDENCE_NOT_SELECTED")); },
    });
  });
}

function inferMime(filename: string, fallback?: string): string {
  const extension = filename.toLowerCase().split(".").pop();
  if (extension === "pdf") return "application/pdf";
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  return fallback === "image" ? "image/jpeg" : "application/octet-stream";
}
