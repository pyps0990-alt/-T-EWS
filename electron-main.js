const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
    const win = new BrowserWindow({
        width: 1280,
        height: 800,
        icon: path.join(__dirname, 'assets/icon.png'), // Optional: if you have an icon
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    win.loadFile('index.html');
    win.removeMenu();
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
