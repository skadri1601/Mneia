import type { ReactNode } from 'react';
import styles from './Tile.module.css';

export type TileSurface = 'canvas' | 'raised' | 'recessed';

type TileProps = {
  surface: TileSurface;
  children: ReactNode;
  wide?: boolean;
  id?: string;
};

export function Tile({ surface, children, wide = false, id }: TileProps) {
  return (
    <section className={`${styles.tile} ${styles[surface]}`} id={id}>
      <div className={`${styles.inner} ${wide ? styles.wide : ''}`}>{children}</div>
    </section>
  );
}
