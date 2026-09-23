import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';

export interface LightboxImage {
  id: string;
  imageBase64: string;
}

interface ImageLightboxProps {
  images: LightboxImage[];
  initialIndex: number;
  onClose: () => void;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.25;
const DOUBLE_CLICK_ZOOM = 2;

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) {
    return 0;
  }
  return Math.min(Math.max(index, 0), length - 1);
}

export function ImageLightbox({ images, initialIndex, onClose }: ImageLightboxProps) {
  const [index, setIndex] = useState(() => clampIndex(initialIndex, images.length));
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(
    null,
  );

  const hasMultipleImages = images.length > 1;
  const currentImage = images[index];

  const goToPrevious = useCallback(() => {
    setIndex((currentIndex) => (currentIndex - 1 + images.length) % images.length);
  }, [images.length]);

  const goToNext = useCallback(() => {
    setIndex((currentIndex) => (currentIndex + 1) % images.length);
  }, [images.length]);

  const resetZoom = useCallback(() => {
    setZoom(MIN_ZOOM);
    setPan({ x: 0, y: 0 });
  }, []);

  const zoomIn = useCallback(() => {
    setZoom((currentZoom) => clampZoom(currentZoom + ZOOM_STEP));
  }, []);

  const zoomOut = useCallback(() => {
    setZoom((currentZoom) => {
      const nextZoom = clampZoom(currentZoom - ZOOM_STEP);
      if (nextZoom <= MIN_ZOOM) {
        setPan({ x: 0, y: 0 });
      }
      return nextZoom;
    });
  }, []);

  // Reset zoom/pan whenever the displayed image changes.
  useEffect(() => {
    setZoom(MIN_ZOOM);
    setPan({ x: 0, y: 0 });
  }, [index]);

  // Lock body scroll while the lightbox is open, restore on unmount.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  // Focus the dialog on open so Escape/arrow keys work immediately.
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  // Keyboard navigation: Escape closes, arrows navigate between images.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      } else if (event.key === 'ArrowLeft' && hasMultipleImages) {
        goToPrevious();
      } else if (event.key === 'ArrowRight' && hasMultipleImages) {
        goToNext();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goToNext, goToPrevious, hasMultipleImages, onClose]);

  // Wheel zoom needs a non-passive listener so preventDefault stops page scroll.
  useEffect(() => {
    const dialogElement = dialogRef.current;
    if (!dialogElement) {
      return undefined;
    }

    function handleWheel(event: WheelEvent) {
      event.preventDefault();
      const delta = event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      setZoom((currentZoom) => {
        const nextZoom = clampZoom(currentZoom + delta);
        if (nextZoom <= MIN_ZOOM) {
          setPan({ x: 0, y: 0 });
        }
        return nextZoom;
      });
    }

    dialogElement.addEventListener('wheel', handleWheel, { passive: false });
    return () => dialogElement.removeEventListener('wheel', handleWheel);
  }, []);

  function handleBackdropClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      onClose();
    }
  }

  function handleImageDoubleClick() {
    if (zoom > MIN_ZOOM) {
      resetZoom();
    } else {
      setZoom(DOUBLE_CLICK_ZOOM);
    }
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLImageElement>) {
    if (zoom <= MIN_ZOOM) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: pan.x,
      originY: pan.y,
    };
    setIsDragging(true);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLImageElement>) {
    const dragState = dragStateRef.current;
    if (!dragState) {
      return;
    }
    setPan({
      x: dragState.originX + (event.clientX - dragState.startX),
      y: dragState.originY + (event.clientY - dragState.startY),
    });
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLImageElement>) {
    if (dragStateRef.current && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragStateRef.current = null;
    setIsDragging(false);
  }

  if (!currentImage) {
    return null;
  }

  const zoomPercent = Math.round(zoom * 100);
  const imageCursorClass =
    zoom > MIN_ZOOM ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in';

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
      tabIndex={-1}
      ref={dialogRef}
      onClick={handleBackdropClick}
    >
      <div className="absolute right-4 top-4 flex items-center gap-2">
        <button
          className="rounded-md border border-line bg-control px-2 py-1 text-xs font-medium text-fg hover:bg-control-hover"
          type="button"
          aria-label="Zoom out"
          onClick={zoomOut}
          disabled={zoom <= MIN_ZOOM}
        >
          −
        </button>
        <span className="rounded-md border border-line bg-control px-2 py-1 text-xs font-medium text-fg">
          {zoomPercent}%
        </span>
        <button
          className="rounded-md border border-line bg-control px-2 py-1 text-xs font-medium text-fg hover:bg-control-hover"
          type="button"
          aria-label="Zoom in"
          onClick={zoomIn}
          disabled={zoom >= MAX_ZOOM}
        >
          +
        </button>
        <button
          className="rounded-md border border-line bg-control px-2 py-1 text-xs font-medium text-fg hover:bg-control-hover"
          type="button"
          aria-label="Reset zoom"
          onClick={resetZoom}
        >
          Reset
        </button>
        <button
          className="rounded-md border border-line bg-control px-2 py-1 text-xs font-medium text-fg hover:bg-control-hover"
          type="button"
          aria-label="Close image preview"
          onClick={onClose}
        >
          ✕ Close
        </button>
      </div>

      {hasMultipleImages ? (
        <>
          <button
            className="absolute left-4 top-1/2 -translate-y-1/2 rounded-md border border-line bg-control px-2 py-1 text-xs font-medium text-fg hover:bg-control-hover"
            type="button"
            aria-label="Previous image"
            onClick={goToPrevious}
          >
            ‹
          </button>
          <button
            className="absolute right-4 top-1/2 -translate-y-1/2 rounded-md border border-line bg-control px-2 py-1 text-xs font-medium text-fg hover:bg-control-hover"
            type="button"
            aria-label="Next image"
            onClick={goToNext}
          >
            ›
          </button>
          <span className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-md border border-line bg-control px-2 py-1 text-xs font-medium text-fg">
            {index + 1} / {images.length}
          </span>
        </>
      ) : null}

      <img
        key={currentImage.id}
        className={`max-h-[85vh] max-w-[90vw] select-none object-contain ${imageCursorClass}`}
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transition: isDragging ? 'none' : 'transform 150ms ease-out',
        }}
        src={currentImage.imageBase64}
        alt="Task attachment preview"
        draggable={false}
        onDoubleClick={handleImageDoubleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
    </div>,
    document.body,
  );
}
