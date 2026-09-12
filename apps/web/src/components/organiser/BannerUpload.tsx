import type { UploadSignature } from '@gatherly/types';
import { ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { api, ApiRequestError } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { Button } from '../ui';

const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Uploads straight from the browser to Cloudinary using parameters the API
 * has signed. The image never passes through our server.
 */
export function BannerUpload({
  value,
  onChange,
}: {
  value: string;
  onChange: (url: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setError(null);
    if (!TYPES.includes(file.type)) return setError('Use a JPG, PNG or WebP image.');
    if (file.size > MAX_BYTES) return setError('Images must be 5 MB or smaller.');

    setUploading(true);
    try {
      const sig = await api<UploadSignature>('/organiser/uploads/banner-signature', {
        method: 'POST',
      });
      const form = new FormData();
      form.append('file', file);
      form.append('api_key', sig.apiKey);
      form.append('timestamp', String(sig.timestamp));
      form.append('signature', sig.signature);
      form.append('folder', sig.folder);
      form.append('allowed_formats', sig.allowedFormats);
      const res = await fetch(sig.uploadUrl, { method: 'POST', body: form });
      const body = (await res.json()) as { secure_url?: string; error?: { message: string } };
      if (!res.ok || !body.secure_url) throw new Error(body.error?.message ?? 'Upload failed');
      onChange(body.secure_url);
    } catch (err) {
      setError(
        err instanceof ApiRequestError && err.status === 503
          ? 'Image uploads are not configured on this server yet. You can paste an image URL instead.'
          : errorMessage(err),
      );
    } finally {
      setUploading(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className="space-y-2">
      {value ? (
        <div className="relative overflow-hidden rounded-lg ring-1 ring-slate-200">
          <img
            src={value}
            alt="Event banner preview"
            className="aspect-[16/6] w-full object-cover"
          />
          <button
            type="button"
            onClick={() => onChange('')}
            className="absolute right-2 top-2 rounded-lg bg-white/90 p-2 text-slate-700 shadow hover:bg-white"
            aria-label="Remove banner"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={uploading}
          className="flex aspect-[16/6] w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 text-slate-500 hover:border-brand-400 hover:text-brand-600"
        >
          {uploading ? (
            <Loader2 className="size-6 animate-spin" />
          ) : (
            <ImagePlus className="size-6" />
          )}
          <span className="text-sm font-medium">
            {uploading ? 'Uploading…' : 'Upload a banner image'}
          </span>
          <span className="text-xs">JPG, PNG or WebP · up to 5 MB · wide images look best</span>
        </button>
      )}
      <input
        ref={input}
        type="file"
        accept={TYPES.join(',')}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      {value && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => input.current?.click()}
          loading={uploading}
        >
          Replace image
        </Button>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
