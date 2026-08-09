import { app, Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';

/**
 * A minimal menu, built almost entirely from roles so the shortcuts behave
 * natively. On Windows and Linux the bar itself is hidden — the custom title
 * bar is the whole point — but the menu still has to exist, because that is
 * what registers Ctrl-C, Ctrl-V and friends. Without it the draft textarea in
 * Phase 3 would silently lose copy and paste.
 */
export function buildMenu(getWindow: () => BrowserWindow | null): Menu {
  const isMac = process.platform === 'darwin';

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ] satisfies MenuItemConstructorOptions[])
      : []),
    {
      label: '&File',
      submenu: [
        {
          label: 'Poll sources now',
          accelerator: 'CmdOrCtrl+R',
          click: () => getWindow()?.webContents.send('signal:menu', 'poll'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: '&Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: '&View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: '&Window',
      submenu: [{ role: 'minimize' }, ...(isMac ? ([{ role: 'zoom' }] as const) : []), { role: 'close' }],
    },
  ];

  return Menu.buildFromTemplate(template);
}
