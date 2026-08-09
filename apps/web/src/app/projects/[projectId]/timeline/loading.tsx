import type { ReactNode } from 'react';
import { ProjectSectionLoading } from '../../../../components/project-workspace/ProjectSectionLoading.js';

export default function ProjectTimelineLoading(): ReactNode {
  return <ProjectSectionLoading section="timeline" />;
}
