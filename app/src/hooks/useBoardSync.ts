import { useEffect, useState } from 'react';
import {
  getBoardSyncStatus,
  onBoardSyncStatus,
  type BoardSyncStatus,
} from '../utils/boardSyncState';

export function useBoardSync(): BoardSyncStatus {
  const [syncStatus, setSyncStatus] = useState<BoardSyncStatus>(getBoardSyncStatus());
  useEffect(() => onBoardSyncStatus(setSyncStatus), []);
  return syncStatus;
}
