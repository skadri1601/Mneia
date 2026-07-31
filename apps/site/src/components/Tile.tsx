import type { ReactNode } from 'react';
import styles from './Tile.module.css';

export type TileSurface = 'canvas' | 'parchment' | 'dark1' | 'dark2' | 'dark3';

type TileProps = {
  surface: TileSurface;
  children: ReactNode;
  wide?: boolean;
  centered?: boolean;
  id?: string;
};

export function Tile({ surface, children, wide = false, centered = false, id }: TileProps) {
  return (
    <section className={`${styles.tile} ${styles[surface]}`} id={id}>
      <div
        className={`${styles.inner} ${wide ? styles.wide : ''} ${centered ? styles.centered : ''}`}
      >
        {children}
      </div>
    </section>
  );
}
