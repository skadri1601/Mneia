'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode, useEffect, useRef } from 'react';
import { useProjectMenu } from './ProjectMenuProvider.js';
import styles from './ProjectWorkspace.module.css';

export interface ProjectIdentity {
  readonly id: string;
  readonly displayName: string;
  readonly slug: string;
}

const SECTIONS = [
  { suffix: '', label: 'Overview' },
  { suffix: '/decisions', label: 'Decisions' },
  { suffix: '/timeline', label: 'Timeline' },
  { suffix: '/handoffs', label: 'Handoffs' },
  { suffix: '/review', label: 'Review queue' },
] as const;

const ALL_PROJECTS = '/projects';

export function ProjectWorkspace({
  children,
  project,
}: Readonly<{ children: ReactNode; project: ProjectIdentity }>): ReactNode {
  const pathname = usePathname();
  const { dismiss, mobile, open, toggleRef } = useProjectMenu();
  const overviewRef = useRef<HTMLAnchorElement | null>(null);
  const sidebarHeldFocus = useRef(false);

  const base = `${ALL_PROJECTS}/${project.id}`;
  const destinations = SECTIONS.map((section) => ({
    href: `${base}${section.suffix}`,
    label: section.label,
  }));
  const current = destinations.find((destination) => destination.href === pathname);
  const sectionLabel = current?.label ?? SECTIONS[0].label;
  const onOverview = sectionLabel === SECTIONS[0].label;
  const drawerOpen = mobile && open;

  useEffect(() => {
    if (drawerOpen) {
      overviewRef.current?.focus();
    }
  }, [drawerOpen]);

  useEffect(() => {
    if (!drawerOpen) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [drawerOpen]);

  useEffect(() => {
    if (open) {
      return;
    }
    const heldFocus = sidebarHeldFocus.current;
    sidebarHeldFocus.current = false;
    if (!mobile && heldFocus) {
      toggleRef.current?.focus();
    }
  }, [mobile, open, toggleRef]);

  const closeDrawer = (restoreFocus: boolean) => {
    if (mobile) {
      dismiss(restoreFocus);
    }
  };

  return (
    <div className={styles.workspace}>
      <aside
        className={styles.sidebar}
        onBlurCapture={() => {
          sidebarHeldFocus.current = false;
        }}
        onFocusCapture={() => {
          sidebarHeldFocus.current = true;
        }}
        {...(open ? {} : { 'aria-hidden': true, inert: true })}
      >
        <div className={styles.identity}>
          <p className={styles.projectName}>{project.displayName}</p>
          <dl className={styles.binding}>
            <dt className={styles.bindingLabel}>Repository binding</dt>
            <dd className={styles.bindingValue}>{project.slug}</dd>
          </dl>
        </div>

        <nav aria-label="Project navigation" className={styles.nav} id="project-navigation">
          <ul className={styles.destinations}>
            {destinations.map((destination, index) => (
              <li key={destination.href}>
                <Link
                  aria-current={destination.href === pathname ? 'page' : undefined}
                  className={styles.destination}
                  href={destination.href}
                  onClick={() => closeDrawer(false)}
                  ref={index === 0 ? overviewRef : undefined}
                >
                  {destination.label}
                </Link>
              </li>
            ))}
            <li className={styles.allProjects}>
              <Link
                className={styles.destination}
                href={ALL_PROJECTS}
                onClick={() => closeDrawer(false)}
              >
                All projects
              </Link>
            </li>
          </ul>
        </nav>
      </aside>

      {drawerOpen ? (
        <button
          aria-label="Close project menu"
          className={styles.backdrop}
          onClick={() => dismiss(true)}
          type="button"
        />
      ) : null}

      <main
        className={styles.content}
        id="project-content"
        tabIndex={-1}
        {...(drawerOpen ? { inert: true } : {})}
      >
        <nav aria-label="Breadcrumb" className={styles.breadcrumb}>
          <ol className={styles.crumbs}>
            <li>
              <Link href={ALL_PROJECTS}>Projects</Link>
            </li>
            <li>
              {onOverview ? project.displayName : <Link href={base}>{project.displayName}</Link>}
            </li>
            <li>{sectionLabel}</li>
          </ol>
        </nav>

        <div className={styles.routeContent} key={pathname}>
          {children}
        </div>
      </main>
    </div>
  );
}
