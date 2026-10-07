/**
 * directory: public API.
 *
 * Organisations, people and teams — the records that must exist before a
 * ticket can. The ONLY file other modules and the app shell may import from.
 */
export { registerDirectoryRoutes } from "./directory.routes.js";
export { DirectoryService } from "./directory.service.js";
export type {
  CreateOrganizationInput,
  CreatePersonInput,
  CreateTeamInput,
  DirectoryListQuery,
  DirectoryListResult,
  DirectoryOptions,
  OrganizationDto,
  PersonDto,
  RecordStatus,
  TeamDto,
  UpdateOrganizationInput,
  UpdatePersonInput,
  UpdateTeamInput,
} from "./directory.types.js";
