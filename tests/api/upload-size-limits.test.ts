import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { File } from "@google-cloud/storage";
import {
  MAX_FIELD_PHOTO_SIZE_BYTES,
  MAX_LOGO_SIZE_BYTES,
} from "@shared/upload-limits";

vi.mock("../../server/replit_integrations/object_storage/objectAcl", async () => {
  const actual = await vi.importActual<
    typeof import("../../server/replit_integrations/object_storage/objectAcl")
  >("../../server/replit_integrations/object_storage/objectAcl");
  return {
    ...actual,
    getObjectAclPolicy: vi.fn(async () => null),
    setObjectAclPolicy: vi.fn(async () => undefined),
  };
});

import {
  ObjectStorageService,
  MAX_UPLOAD_SIZE_BYTES,
} from "../../server/replit_integrations/object_storage/objectStorage";
import {
  getObjectAclPolicy,
  setObjectAclPolicy,
  type ObjectAclPolicy,
} from "../../server/replit_integrations/object_storage/objectAcl";

interface MockFile {
  delete: ReturnType<typeof vi.fn>;
  getMetadata: ReturnType<typeof vi.fn>;
}

function makeMockFile(opts: { size: number; contentType?: string }): MockFile {
  return {
    delete: vi.fn(async () => undefined),
    getMetadata: vi.fn(async () => [
      {
        size: opts.size,
        contentType: opts.contentType ?? "image/jpeg",
      },
    ]),
  };
}

function patchOss(file: MockFile): ObjectStorageService {
  const oss = new ObjectStorageService();
  // Replace the prototype method via spyOn so we don't need to widen the type.
  // Cast to File only at the boundary — we control the shape this method
  // touches inside validateUploadedFileAndSetAcl (delete, getMetadata).
  vi.spyOn(ObjectStorageService.prototype, "getObjectEntityFile").mockResolvedValue(
    file as unknown as File,
  );
  return oss;
}

const mockedGetAcl = vi.mocked(getObjectAclPolicy);
const mockedSetAcl = vi.mocked(setObjectAclPolicy);

describe("validateUploadedFileAndSetAcl — server-side size enforcement", () => {
  beforeEach(() => {
    mockedGetAcl.mockReset();
    mockedSetAcl.mockReset();
    mockedGetAcl.mockResolvedValue(null);
    mockedSetAcl.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("avvisar och raderar foto > 15 MB i confirm-steget", async () => {
    const file = makeMockFile({ size: MAX_FIELD_PHOTO_SIZE_BYTES + 1 });
    const oss = patchOss(file);

    await expect(
      oss.validateUploadedFileAndSetAcl(
        "/objects/uploads/abc",
        "tenant:t1",
        "private",
        MAX_FIELD_PHOTO_SIZE_BYTES,
      ),
    ).rejects.toThrow(/exceeds the maximum allowed size/);

    expect(file.delete).toHaveBeenCalledTimes(1);
    expect(mockedSetAcl).not.toHaveBeenCalled();
  });

  it("accepterar foto exakt på 15 MB-gränsen och sätter ACL", async () => {
    const file = makeMockFile({ size: MAX_FIELD_PHOTO_SIZE_BYTES });
    const oss = patchOss(file);

    await oss.validateUploadedFileAndSetAcl(
      "/objects/uploads/ok",
      "tenant:t1",
      "private",
      MAX_FIELD_PHOTO_SIZE_BYTES,
    );

    expect(file.delete).not.toHaveBeenCalled();
    expect(mockedSetAcl).toHaveBeenCalledTimes(1);
  });

  it("avvisar logo > 5 MB även om global gräns är 50 MB", async () => {
    // 6 MB: under field-photo-gränsen (15 MB) och global gräns (50 MB),
    // men över logo-gränsen (5 MB). Säkerställer att en framtida refaktor
    // inte råkar skicka in fel maxSize och därmed släppa igenom stora logotyper.
    const file = makeMockFile({
      size: MAX_LOGO_SIZE_BYTES + 1024 * 1024,
      contentType: "image/png",
    });
    const oss = patchOss(file);

    await expect(
      oss.validateUploadedFileAndSetAcl(
        "/objects/uploads/logo",
        "tenant:t1",
        "public",
        MAX_LOGO_SIZE_BYTES,
      ),
    ).rejects.toThrow(/exceeds the maximum allowed size/);

    expect(file.delete).toHaveBeenCalledTimes(1);
    expect(mockedSetAcl).not.toHaveBeenCalled();
  });

  it("accepterar logo under 5 MB-gränsen", async () => {
    const file = makeMockFile({
      size: MAX_LOGO_SIZE_BYTES - 1,
      contentType: "image/png",
    });
    const oss = patchOss(file);

    await oss.validateUploadedFileAndSetAcl(
      "/objects/uploads/logo-ok",
      "tenant:t1",
      "public",
      MAX_LOGO_SIZE_BYTES,
    );

    expect(file.delete).not.toHaveBeenCalled();
    expect(mockedSetAcl).toHaveBeenCalledTimes(1);
  });

  it("klampar caller-supplied maxSize till MAX_UPLOAD_SIZE_BYTES (50 MB)", async () => {
    // Anropare som råkar skicka in en jättestor maxSize (t.ex. 100 MB) får
    // ändå inte ladda upp större än det globala taket. 51 MB ska förkastas.
    const file = makeMockFile({ size: MAX_UPLOAD_SIZE_BYTES + 1 });
    const oss = patchOss(file);

    await expect(
      oss.validateUploadedFileAndSetAcl(
        "/objects/uploads/huge",
        "tenant:t1",
        "private",
        100 * 1024 * 1024,
      ),
    ).rejects.toThrow(/exceeds the maximum allowed size/);

    expect(file.delete).toHaveBeenCalledTimes(1);
  });

  it("är idempotent: samma owner som re-confirmar gör ingen storlekskontroll", async () => {
    // Existerande policy med samma owner → tidig retur, ingen storlekskoll och
    // ingen radering, även om filen råkar vara över gränsen.
    const existingPolicy: ObjectAclPolicy = {
      owner: "tenant:t1",
      visibility: "private",
    };
    mockedGetAcl.mockResolvedValueOnce(existingPolicy);

    const file = makeMockFile({ size: MAX_FIELD_PHOTO_SIZE_BYTES + 9999 });
    const oss = patchOss(file);

    await oss.validateUploadedFileAndSetAcl(
      "/objects/uploads/already-confirmed",
      "tenant:t1",
      "private",
      MAX_FIELD_PHOTO_SIZE_BYTES,
    );

    expect(file.delete).not.toHaveBeenCalled();
    expect(mockedSetAcl).not.toHaveBeenCalled();
  });
});
