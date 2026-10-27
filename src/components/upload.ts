import { repo } from '../persistence/repository';
import { errorMessage, toast } from '../state/uiStore';

export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp';

/** Uploads files to the asset store, reporting validation errors as toasts. */
export async function uploadImages(files: FileList | File[]): Promise<{ id: string; name: string }[]> {
  const out: { id: string; name: string }[] = [];
  for (const file of Array.from(files)) {
    try {
      out.push({ id: await repo.addAsset(file), name: file.name.replace(/\.[^.]+$/, '') });
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }
  return out;
}
