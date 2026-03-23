import { lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { Home } from '../pages/Home';
import { Dashboard } from '../pages/Dashboard';
import { Settings } from '../pages/Settings';
import { AISettings } from '../pages/AISettings';
import { ApiKeys } from '../pages/ApiKeys';
import { CrudPages } from '../pages/CrudPages';
import CrudPage from '../pages/CrudPage';
import { RequireAuth } from '../components/RequireAuth';
import { Login } from '../pages/Login';
import Register from '../pages/Register';
import SystemStatus from '../pages/SystemStatus';
import CrudPageItems from '../pages/CrudPageItems';

const routes = [
  {
    path: '/',
    element: <Layout />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/dashboard', element: <Dashboard /> },
      { path: '/settings', element: <Settings /> },
      { path: '/ai-settings', element: <AISettings /> },
      { path: '/api-keys', element: <ApiKeys /> },
      { path: '/crud-pages', element: <CrudPages /> },
      { path: '/crud-pages/:id', element: <CrudPage /> },
      { path: '*', element: <Navigate to="/" /> },
    ],
  },
];

export const AppRoutes: React.FC = () => {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        {routes[0].children.map((route) => (
          <Route key={route.path} path={route.path} element={route.element} />
        ))}
      </Route>
    </Routes>
  );
};

export default routes;    