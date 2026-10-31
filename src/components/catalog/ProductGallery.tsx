"use client";

import Image from "next/image";
import { useId, useState } from "react";

import type { CatalogImage } from "@/features/catalog/types";

import styles from "./ProductGallery.module.css";

type ProductGalleryProps = {
  images: readonly CatalogImage[];
  title: string;
};

/** Main image with thumbnail buttons; keyboard-operable, no auto-rotation. */
export function ProductGallery({ images, title }: ProductGalleryProps) {
  const [index, setIndex] = useState(0);
  const groupId = useId();
  const current = images[index] ?? images[0];
  if (!current) return null;

  return (
    <div className={styles.gallery}>
      <div className={styles.stage}>
        <Image
          key={current.url}
          src={current.url}
          alt={current.alt}
          width={current.width}
          height={current.height}
          sizes="(min-width: 64em) 50vw, 100vw"
          priority={index === 0}
          className={styles.image}
        />
      </div>
      {images.length > 1 ? (
        <div className={styles.thumbs} role="group" aria-labelledby={groupId}>
          <span id={groupId} className="visually-hidden">
            Photographs of {title}
          </span>
          {images.map((image, imageIndex) => (
            <button
              key={image.url}
              type="button"
              className={styles.thumb}
              aria-pressed={imageIndex === index}
              onClick={() => setIndex(imageIndex)}
            >
              <Image
                src={image.url}
                alt=""
                width={120}
                height={150}
                sizes="120px"
              />
              <span className="visually-hidden">{image.alt}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
