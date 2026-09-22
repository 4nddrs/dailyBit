import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { storage } from '../firebase';

export async function uploadTaskImage(
  file: File,
  userId: string,
  date: string,
): Promise<string> {
  const extension = file.name.includes('.') ? file.name.split('.').pop() : undefined;
  const fileName = extension ? `${crypto.randomUUID()}.${extension}` : crypto.randomUUID();
  const imageRef = ref(storage, `reports/${userId}/${date}/${fileName}`);
  const snapshot = await uploadBytes(imageRef, file);

  return getDownloadURL(snapshot.ref);
}
