import { NextResponse } from 'next/server';
import { resolveOwnerId } from '@/lib/contracts/owner';
import { generateTTS, TTSRateLimitError, TTSRequestTimeoutError } from '@/lib/audio/tts-providers';
import { TTS_PROVIDERS } from '@/lib/audio/constants';

interface GenerateTTSBody {
  text?: string;
  voice?: string;
  modelId?: string;
  format?: string;
  speed?: number;
}

const CONTENT_TYPE_BY_FORMAT: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  pcm: 'audio/L16',
  opus: 'audio/opus',
  ulaw: 'audio/basic',
  alaw: 'audio/basic',
};

export async function POST(request: Request) {
  try {
    resolveOwnerId();
  } catch {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let body: GenerateTTSBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const text = body.text?.trim();
  if (!text) {
    return NextResponse.json({ error: '"text" is required' }, { status: 400 });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'ELEVENLABS_API_KEY is not configured' }, { status: 500 });
  }

  const provider = TTS_PROVIDERS['elevenlabs-tts'];
  const voice = body.voice?.trim() || provider.voices[0].id;
  const format = body.format || 'mp3';

  try {
    const result = await generateTTS(
      {
        providerId: 'elevenlabs-tts',
        apiKey,
        voice,
        modelId: body.modelId,
        format,
        speed: body.speed,
        signal: request.signal,
      },
      text,
    );

    return new Response(new Uint8Array(result.audio), {
      status: 200,
      headers: {
        'Content-Type': CONTENT_TYPE_BY_FORMAT[result.format] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof TTSRateLimitError) {
      return NextResponse.json({ error: error.message }, { status: 429 });
    }
    if (error instanceof TTSRequestTimeoutError) {
      return NextResponse.json({ error: error.message }, { status: 504 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
