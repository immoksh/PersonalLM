import type { ReactNode } from 'react';
import { SOURCE_KINDS, type SourceKind } from '@personallm/shared';
import { CaptionIcon, GlobeIcon, PdfIcon, TextIcon, YouTubeIcon } from '@/components/icons';

export interface SourceTypeMeta {
  kind: SourceKind;
  label: string;
  blurb: string;
  icon: ReactNode;
  /** Drives the accent used by the tile and its modal. */
  accent: 'neon' | 'violet';
}

/**
 * One registry for the five source types. The picker, the modals and the cards
 * all read from here, so adding a sixth type is a single entry plus a modal.
 */
export const SOURCE_TYPES: Record<SourceKind, SourceTypeMeta> = {
  pdf: {
    kind: 'pdf',
    label: 'PDF',
    blurb: 'Upload one or more PDF documents',
    icon: <PdfIcon />,
    accent: 'neon',
  },
  text: {
    kind: 'text',
    label: 'Plain Text',
    blurb: 'Write or paste formatted text',
    icon: <TextIcon />,
    accent: 'violet',
  },
  website: {
    kind: 'website',
    label: 'Website URL',
    blurb: 'Pull in a page from the web',
    icon: <GlobeIcon />,
    accent: 'neon',
  },
  youtube: {
    kind: 'youtube',
    label: 'YouTube Video',
    blurb: 'Add a video by its link',
    icon: <YouTubeIcon />,
    accent: 'violet',
  },
  transcript: {
    kind: 'transcript',
    label: 'VTT / Transcript',
    blurb: 'Upload .vtt, .srt or .txt captions',
    icon: <CaptionIcon />,
    accent: 'neon',
  },
};

export const SOURCE_TYPE_LIST: SourceTypeMeta[] = SOURCE_KINDS.map((kind) => SOURCE_TYPES[kind]);
