import { startSelection } from '../src/selection/selection';
import { installSelectionFeature } from '../src/selection/session';

export default defineUnlistedScript(() => installSelectionFeature('selection', startSelection));
