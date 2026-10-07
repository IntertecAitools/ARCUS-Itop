import { createElement } from 'react';
import { createBrowserRouter, Navigate, type RouteObject } from 'react-router-dom';
import { AgentLayout } from '@/app/layouts/AgentLayout';
import { HOME_PATH, modules } from '@/config/modules';
import { NotFoundPage } from './NotFoundPage';

/**
 * The route table is DERIVED from the module registry — it is never hand-written.
 *
 * Only built modules are registered, so every route here resolves to a real
 * screen. A path for an unbuilt module simply doesn't exist and falls through
 * to Not found, which is the honest answer.
 */
const moduleRoutes: RouteObject[] = modules.map((module) => ({
  path: module.path,
  children: [
    { index: true, element: createElement(module.component) },
    ...(module.children ?? []).map((child) => ({
      path: child.path,
      element: createElement(child.component),
    })),
  ],
}));

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AgentLayout />,
    children: [
      { index: true, element: <Navigate to={HOME_PATH} replace /> },
      ...moduleRoutes,
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
