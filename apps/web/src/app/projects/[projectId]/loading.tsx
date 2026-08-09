import type { ReactNode } from 'react';
import { ProjectSectionLoading } from '../../../components/project-workspace/ProjectSectionLoading.js';

export default function ProjectOverviewLoading(): ReactNode {
  return <ProjectSectionLoading section="overview" />;
}
