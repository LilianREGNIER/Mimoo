/**
 * Script Preload Electron exposant de manière sécurisée `window.petAPI` via `contextBridge`.
 * Aucun accès direct à `ipcRenderer` ou aux API Node.js n'est exposé au processus Renderer.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type {
  BootstrapPayload,
  DisplayBoundsInfo,
  PcActivityBatch,
  PetIPCContract,
  SaveDataV1,
  TrayActionType,
  UserSettings,
} from '../core/types';

const petAPI: PetIPCContract = {
  bootstrap(): Promise<BootstrapPayload> {
    return ipcRenderer.invoke('pet:bootstrap');
  },

  saveState(saveData: SaveDataV1): Promise<boolean> {
    return ipcRenderer.invoke('pet:save-state', saveData);
  },

  resetSave(newPetName?: string): Promise<SaveDataV1> {
    return ipcRenderer.invoke('pet:reset-save', newPetName);
  },

  setIgnoreMouseEvents(ignore: boolean, forward: boolean = true): Promise<void> {
    return ipcRenderer.invoke('pet:set-ignore-mouse', ignore, forward);
  },

  updateSettings(settings: Partial<UserSettings>): Promise<UserSettings> {
    return ipcRenderer.invoke('pet:update-settings', settings);
  },

  getDisplays(): Promise<DisplayBoundsInfo[]> {
    return ipcRenderer.invoke('pet:get-displays');
  },

  moveToDisplay(displayId: number): Promise<DisplayBoundsInfo | null> {
    return ipcRenderer.invoke('pet:move-to-display', displayId);
  },

  notifyCriticalNeed(title: string, body: string): Promise<void> {
    return ipcRenderer.invoke('pet:notify-critical', title, body);
  },

  onTrayAction(callback: (action: TrayActionType) => void): () => void {
    const listener = (_event: IpcRendererEvent, action: TrayActionType): void => {
      callback(action);
    };
    ipcRenderer.on('pet:tray-action', listener);
    return () => {
      ipcRenderer.removeListener('pet:tray-action', listener);
    };
  },

  onDisplayChanged(callback: (displays: DisplayBoundsInfo[]) => void): () => void {
    const listener = (_event: IpcRendererEvent, displays: DisplayBoundsInfo[]): void => {
      callback(displays);
    };
    ipcRenderer.on('pet:displays-changed', listener);
    return () => {
      ipcRenderer.removeListener('pet:displays-changed', listener);
    };
  },

  onPcActivityBatch(callback: (batch: PcActivityBatch) => void): () => void {
    const listener = (_event: IpcRendererEvent, batch: PcActivityBatch): void => {
      callback(batch);
    };
    ipcRenderer.on('pet:pc-activity-batch', listener);
    return () => {
      ipcRenderer.removeListener('pet:pc-activity-batch', listener);
    };
  },
};

contextBridge.exposeInMainWorld('petAPI', petAPI);
