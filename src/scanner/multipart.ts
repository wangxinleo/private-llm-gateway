export interface MultipartFileMeta {
  name: string;
  filename: string;
  contentType: string;
}

export interface MultipartParseResult {
  textFields: Map<string, string>;
  files: MultipartFileMeta[];
}

export async function parseMultipart(
  request: Request
): Promise<MultipartParseResult> {
  const formData = await request.formData();
  const textFields = new Map<string, string>();
  const files: MultipartFileMeta[] = [];

  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") {
      textFields.set(key, value);
    } else if (value instanceof Blob) {
      files.push({
        name: key,
        filename: "name" in value ? String((value as File).name) : key,
        contentType: value.type,
      });
    }
  }

  return { textFields, files };
}

export function collectMultipartText(result: MultipartParseResult): string {
  const parts: string[] = [];
  for (const [key, value] of result.textFields) {
    parts.push(`${key}=${value}`);
  }
  return parts.join("&");
}

export function collectFilenames(result: MultipartParseResult): string[] {
  return result.files.map((f) => f.filename);
}
