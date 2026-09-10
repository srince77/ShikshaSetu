import { NextResponse } from 'next/server';
import { resolveOwnerId } from '@/lib/contracts/owner';
import { transcribeAudio } from '@/lib/audio/asr-providers';

export async function POST(request: Request) {
  try {
    resolveOwnerId();
  } catch {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'ELEVENLABS_API_KEY is not configured' }, { status: 500 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data with a "file" field' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: '"file" is required and must be an audio blob' }, { status: 400 });
  }

  const language = formData.get('language');

  try {
    const result = await transcribeAudio(
      {
        providerId: 'elevenlabs-asr',
        apiKey,
        language: typeof language === 'string' ? language : undefined,
      },
      file,
    );
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
