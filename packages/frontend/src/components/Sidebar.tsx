import React from 'react';
import {
  Drawer,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Typography,
  Box,
  useTheme,
  Divider,
} from '@mui/material';
import {
  Home as HomeIcon,
  Dashboard as DashboardIcon,
  Settings as SettingsIcon,
  Storage as StorageIcon,
  Psychology as AIIcon,
  Key as KeyIcon,
  SettingsInputComponent as SettingsInputComponentIcon,
  SmartToy as OpenClawIcon,
} from '@mui/icons-material';
import { useLocation, useNavigate } from 'react-router-dom';
import { Link } from 'react-router-dom';

// Define a type for menu items
interface MenuItem {
  text: string;
  icon: React.ReactNode;
  path: string;
}

const drawerWidth = 240;

const menuItems: MenuItem[] = [
  { text: 'Home', icon: <HomeIcon />, path: '/home' },
  { text: 'Dashboard', icon: <DashboardIcon />, path: '/dashboard' },
  { text: 'AI Dashboard', icon: <AIIcon />, path: '/ai' },
  { text: 'API Keys', icon: <KeyIcon />, path: '/api-keys' },
  { text: 'CRUD Pages', icon: <StorageIcon />, path: '/crud' },
  { text: 'OpenClaw', icon: <OpenClawIcon />, path: '/openclaw' },
  { text: 'Settings', icon: <SettingsIcon />, path: '/settings' },
  { text: 'WebSocket Test', icon: <SettingsInputComponentIcon />, path: '/websocket-test' },
];

export const Sidebar: React.FC = () => {
  const theme = useTheme();
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <Drawer
      variant="permanent"
      sx={{
        width: drawerWidth,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: drawerWidth,
          boxSizing: 'border-box',
          backgroundColor: theme.palette.background.paper,
          borderRight: `1px solid ${theme.palette.divider}`,
        },
      }}
    >
      <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
        <AIIcon sx={{ color: theme.palette.primary.main }} />
        <Typography variant="h6" color="textPrimary">
          Admin AI
        </Typography>
      </Box>
      <Divider />
      <List>
        {menuItems.map((item) => (
          <ListItem
            key={item.text}
            button
            selected={location.pathname === item.path}
            onClick={() => navigate(item.path)}
            sx={{
              '&.Mui-selected': {
                backgroundColor: theme.palette.action.selected,
                '&:hover': {
                  backgroundColor: theme.palette.action.selected,
                },
              },
              '&:hover': {
                backgroundColor: theme.palette.action.hover,
              },
            }}
          >
            <ListItemIcon
              sx={{
                color: location.pathname === item.path
                  ? theme.palette.primary.main
                  : theme.palette.text.secondary,
              }}
            >
              {item.icon}
            </ListItemIcon>
            <ListItemText
              primary={item.text}
              sx={{
                '& .MuiTypography-root': {
                  color: location.pathname === item.path
                    ? theme.palette.primary.main
                    : theme.palette.text.primary,
                  fontWeight: location.pathname === item.path ? 600 : 400,
                },
              }}
            />
          </ListItem>
        ))}
        <ListItem
          button
          onClick={() => navigate('/websocket-test')}
          sx={{
            '&.Mui-selected': {
              backgroundColor: theme.palette.action.selected,
              '&:hover': {
                backgroundColor: theme.palette.action.selected,
              },
            },
            '&:hover': {
              backgroundColor: theme.palette.action.hover,
            },
          }}
        >
          <ListItemIcon
            sx={{
              color: location.pathname === '/websocket-test'
                ? theme.palette.primary.main
                : theme.palette.text.secondary,
            }}
          >
            <SettingsIcon />
          </ListItemIcon>
          <ListItemText
            primary="WebSocket Test"
            sx={{
              '& .MuiTypography-root': {
                color: location.pathname === '/websocket-test'
                  ? theme.palette.primary.main
                  : theme.palette.text.primary,
                fontWeight: location.pathname === '/websocket-test' ? 600 : 400,
              },
            }}
          />
        </ListItem>
      </List>
    </Drawer>
  );
};  