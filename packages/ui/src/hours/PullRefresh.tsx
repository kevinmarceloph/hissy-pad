import { useState, type ComponentRef, type ReactElement, type RefObject } from 'react';
import { RefreshControl, type ScrollView } from 'react-native';

import { useTheme } from './theme';

type Props = { list: RefObject<ComponentRef<typeof ScrollView> | null>; onRefresh: () => Promise<void> };

// Pull the hours down to sync. On phones this is the platform's own control, handed to the
// list. The web has no such control: PullRefresh.web.tsx reads the touches itself and draws
// a line of words above the list.
export function useRefreshControl(onRefresh: () => Promise<void>): ReactElement | undefined {
  const theme = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  const run = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };
  return <RefreshControl refreshing={refreshing} onRefresh={() => void run()} tintColor={theme.inkSoft} colors={[theme.accent]} />;
}

export function PullIndicator(_props: Props): ReactElement | null {
  return null;
}
