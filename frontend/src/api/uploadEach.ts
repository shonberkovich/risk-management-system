import { apiErrorMessage } from "./errors";

/** Uploads `files` one at a time; a failing file doesn't stop the ones after it.
 * Returns a Hebrew message naming each file that failed and why, or null when all
 * of them went up. Callers refresh their list either way, since some may have. */
export async function uploadEach(files: File[], upload: (file: File) => Promise<unknown>): Promise<string | null> {
  const failed: string[] = [];
  for (const file of files) {
    try {
      await upload(file);
    } catch (err) {
      failed.push(`${file.name} — ${apiErrorMessage(err, "ההעלאה נכשלה")}`);
    }
  }
  if (failed.length === 0) return null;
  const head =
    files.length === 1
      ? "העלאת הקובץ נכשלה"
      : failed.length === files.length
        ? "העלאת הקבצים נכשלה"
        : `${failed.length} מתוך ${files.length} קבצים לא הועלו`;
  return `${head}: ${failed.join("; ")}`;
}
