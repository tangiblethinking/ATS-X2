import { createRouter } from "@tanstack/react-router";
import { AppErrorComponent } from "@/lib/error-component";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({
    routeTree,
    defaultErrorComponent: AppErrorComponent,
    // Must match vite `base` (without trailing slash) so client routing
    // treats /job as the app root when served at uxapex.com/job.
    basepath: "/job",
  });
}
