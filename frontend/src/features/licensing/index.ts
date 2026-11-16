// licensing: public API. Other features may import ONLY from this file.
export { LicenceBanners } from './components/LicenceBanners';
export { EditionGate, NotInEdition } from './components/NotInEdition';
export {
  LICENCE_STATUS_KEY,
  licenceFeatureRefusal,
  useCheckLicence,
  useEditionFeatures,
  useEditionFor,
  useInstallLicence,
  useLicenceStatus,
} from './api/licensing.api';
export type * from './types';
