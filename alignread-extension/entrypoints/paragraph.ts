import { startParagraphs } from '../src/selection/paragraphs';
import { installSelectionFeature } from '../src/selection/session';

export default defineUnlistedScript(() => installSelectionFeature('paragraph', startParagraphs));
