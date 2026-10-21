import { createElement } from 'react';
import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { AgentLayout } from '@/app/layouts/AgentLayout';
import { ForgotPasswordPage, LoginPage, RequireAuth, ResetPasswordPage } from '@/features/auth';
import { LandingPage } from '@/features/landing';
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
import { modules } from '@/config/modules';
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
  // The public front door. Signed-in visitors are sent on to their own home
  // (staff → dashboard, end users → portal), as `/` always did.
  { path: '/', element: <LandingPage /> },
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
    // Pathless: the staff shell wraps every module route, but `/` itself is
    // the landing page above.
    element: (
      <RequireAuth audience="staff">
        <AgentLayout />
      </RequireAuth>
    ),
    children: [
      ...moduleRoutes,
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
