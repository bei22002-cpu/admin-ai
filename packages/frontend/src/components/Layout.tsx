import React, { useEffect } from 'react';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import {
  AppBar,
  Box,
  CssBaseline,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography,
  Divider,
  useTheme as useMuiTheme
} from '@mui/material';
import {
  Menu as MenuIcon,
  Home as HomeIcon,
  Settings as SettingsIcon,
  Dashboard as DashboardIcon,
  Storage as StorageIcon,
  LightMode as LightIcon,
  DarkMode as DarkIcon,
  Logout as LogoutIcon,
  SmartToy as AIIcon,
  Key as KeyIcon,
  SettingsInputComponent as SettingsInputComponentIcon,
  SmartToy as OpenClawIcon
} from '@mui/icons-material';
import { useTheme } from '../providers/ThemeProvider';
import { useAuth } from '../contexts/AuthContext';
import { DynamicCrudMenu } from './DynamicCrudMenu';
import { logger } from '../utils/logger';
import { AIAssistantPanel } from './AIAssistantPanel';

const drawerWidth = 240;

interface MenuItem {
  text?: string;
  icon?: React.ReactNode;
  path?: string;
  divider?: boolean;
}

export const Layout: React.FC = () => {
  const muiTheme = useMuiTheme();
  const { theme, toggleTheme } = useTheme();
  const { logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = React.useState(false);

  useEffect(() => {
    logger.debug('Layout mounted', { pathname: location.pathname });
    return () => {
      logger.debug('Layout unmounted');
    };
  }, [location.pathname]);

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch (error) {
      logger.error('Logout failed:', error);
    }
  };

  const menuItems: MenuItem[] = [
    { text: 'Home', icon: <HomeIcon />, path: '/home' },
    { text: 'Dashboard', icon: <DashboardIcon />, path: '/dashboard' },
    { divider: true },
    { text: 'CRUD Pages', icon: <StorageIcon />, path: '/crud' },
    { text: 'API Keys', icon: <KeyIcon />, path: '/api-keys' },
    { divider: true },
    { text: 'AI Settings', icon: <SettingsIcon />, path: '/ai-settings' },
    { text: 'OpenClaw', icon: <OpenClawIcon />, path: '/openclaw' },
    { text: 'Settings', icon: <SettingsIcon />, path: '/settings' },
    { divider: true }
  ];

  const handleNavigation = (path: string) => {
    logger.debug('Navigation requested', { from: location.pathname, to: path });
    navigate(path);
    if (mobileOpen) {
      setMobileOpen(false);
    }
  };

  const drawer = (
    <div>
      <Toolbar>
        <Typography variant="h6" noWrap>
          Admin AI
        </Typography>
      </Toolbar>
      <List>
        {menuItems.map((item, index) => (
          item.divider ? (
            <Divider key={`divider-${index}`} sx={{ my: 1 }} />
          ) : (
            <ListItem
              key={item.text}
              onClick={() => handleNavigation(item.path || '')}
              sx={{
                bgcolor: location.pathname === item.path ? 'action.selected' : 'transparent',
                '&:hover': {
                  bgcolor: 'action.hover',
                  cursor: 'pointer'
                }
              }}
            >
              <ListItemIcon>{item.icon}</ListItemIcon>
              <ListItemText primary={item.text} />
            </ListItem>
          )
        ))}
      </List>
      <Divider />
      <DynamicCrudMenu onNavigate={() => setMobileOpen(false)} />
    </div>
  );

  return (
    <Box sx={{ display: 'flex' }}>
      <CssBaseline />
      <AppBar
        position="fixed"
        sx={{
          width: { sm: `calc(100% - ${drawerWidth}px)` },
          ml: { sm: `${drawerWidth}px` }
        }}
      >
        <Toolbar>
          <IconButton
            color="inherit"
            aria-label="open drawer"
            edge="start"
            onClick={handleDrawerToggle}
            sx={{ mr: 2, display: { sm: 'none' } }}
          >
            <MenuIcon />
          </IconButton>
          <Typography variant="h6" noWrap component="div" sx={{ flexGrow: 1 }}>
            {menuItems.find(item => item.path === location.pathname)?.text || 'Admin AI'}
          </Typography>
          <IconButton color="inherit" onClick={toggleTheme}>
            {theme === 'dark' ? <LightIcon /> : <DarkIcon />}
          </IconButton>
          <IconButton color="inherit" onClick={handleLogout}>
            <LogoutIcon />
          </IconButton>
        </Toolbar>
      </AppBar>
      <Box
        component="nav"
        sx={{ width: { sm: drawerWidth }, flexShrink: { sm: 0 } }}
      >
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={handleDrawerToggle}
          ModalProps={{
            keepMounted: true // Better open performance on mobile.
          }}
          sx={{
            display: { xs: 'block', sm: 'none' },
            '& .MuiDrawer-paper': {
              boxSizing: 'border-box',
              width: drawerWidth
            }
          }}
        >
          {drawer}
        </Drawer>
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: 'none', sm: 'block' },
            '& .MuiDrawer-paper': {
              boxSizing: 'border-box',
              width: drawerWidth
            }
          }}
          open
        >
          {drawer}
        </Drawer>
      </Box>
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: 3,
          width: { sm: `calc(100% - ${drawerWidth}px)` },
          mt: '64px'
        }}
      >
        <Outlet />
      </Box>
      <AIAssistantPanel />
    </Box>
  );
};  