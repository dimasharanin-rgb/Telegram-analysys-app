/**
 * Media processing interfaces.
 *
 * Nothing in the MVP implements image, audio or video analysis. These
 * interfaces exist so that when a processor is added it plugs into the
 * existing conversation model and the existing pipeline stage, rather than
 * requiring either to be reshaped.
 *
 * The one processor shipped today is `UnsupportedMediaProcessor`, which
 * produces the placeholder used in the UI and guarantees that no media ever
 * reaches the AI provider.
 */

import {
  MEDIA_PLACEHOLDER,
  MessageType,
  type MediaAnalysis,
  type MediaAttachment,
} from "@/lib/model/message";

export interface MediaProcessorContext {
  /** Absolute path or URL the processor may read from, when one exists. */
  source?: string;
  signal?: AbortSignal;
}

export interface MediaProcessor {
  readonly name: string;
  /** Which attachment kinds this processor claims. */
  supports(kind: MessageType): boolean;

  processImage(
    attachment: MediaAttachment,
    context?: MediaProcessorContext,
  ): Promise<MediaAnalysis | null>;

  processAudio(
    attachment: MediaAttachment,
    context?: MediaProcessorContext,
  ): Promise<MediaAnalysis | null>;

  processVideo(
    attachment: MediaAttachment,
    context?: MediaProcessorContext,
  ): Promise<MediaAnalysis | null>;
}

/**
 * MVP behaviour: recognise media, describe it as unanalysed, never open the
 * underlying file and never forward it to a model.
 */
export class UnsupportedMediaProcessor implements MediaProcessor {
  readonly name = "unsupported-media";

  supports(kind: MessageType): boolean {
    return (
      kind === MessageType.IMAGE ||
      kind === MessageType.AUDIO ||
      kind === MessageType.VIDEO ||
      kind === MessageType.STICKER ||
      kind === MessageType.FILE
    );
  }

  async processImage(): Promise<MediaAnalysis | null> {
    return null;
  }

  async processAudio(): Promise<MediaAnalysis | null> {
    return null;
  }

  async processVideo(): Promise<MediaAnalysis | null> {
    return null;
  }
}

/**
 * Registry that future processors register into. `describe()` is what the rest
 * of the app calls today, and it keeps returning the placeholder until a
 * processor actually produces an analysis.
 */
export class MediaProcessorRegistry {
  private readonly processors: MediaProcessor[] = [];

  register(processor: MediaProcessor): this {
    this.processors.push(processor);
    return this;
  }

  find(kind: MessageType): MediaProcessor | undefined {
    return this.processors.find((processor) => processor.supports(kind));
  }

  /**
   * Human-readable description of an attachment, used in previews and in the
   * excerpts handed to the AI provider.
   */
  describe(attachment: MediaAttachment): string {
    if (attachment.analysis) return attachment.analysis.summary;
    return MEDIA_PLACEHOLDER;
  }
}

export const mediaRegistry = new MediaProcessorRegistry().register(
  new UnsupportedMediaProcessor(),
);
