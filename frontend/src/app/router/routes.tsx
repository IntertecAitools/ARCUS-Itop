import { createElement } from 'react';
import { createBrowserRouter, Navigate, type RouteObject } from 'react-router-dom';
import { AgentLayout } from '@/app/layouts/AgentLayout';
import { ForgotPasswordPage, LoginPage, RequireAuth, ResetPasswordPage } from '@/features/auth';
import {
  PortalFaqPage,
  PortalFaqsPage,
  PortalHomePage,
  PortalLayout,
  PortalNewRequestPage,
  PortalProfilePage,
  PortalRequestPage,
  PortalRequestsPage,
} from '@/features/portal';
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
  // Outside the shell: the screens someone who is not signed in can see.
  { path: '/login', element: <LoginPage /> },
  // Password reset by email: also reachable without a session.
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  // The self-service portal, for end users (staff may open it too).
  {
    path: '/portal',
    element: (
      <RequireAuth>
        <PortalLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <PortalHomePage /> },
      { path: 'requests', element: <PortalRequestsPage /> },
      { path: 'requests/:id', element: <PortalRequestPage /> },
      { path: 'new', element: <PortalNewRequestPage /> },
      { path: 'help', element: <PortalFaqsPage /> },
      { path: 'help/:id', element: <PortalFaqPage /> },
      { path: 'profile', element: <PortalProfilePage /> },
    ],
  },
  {
    path: '/',
    element: (
      <RequireAuth audience="staff">
        <AgentLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to={HOME_PATH} replace /> },
      ...moduleRoutes,
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
