import React from 'react';
import { createRoot } from 'react-dom/client';
import Play from './Play.jsx';
import Host from './Host.jsx';
import Admin from './Admin.jsx';
import './styles.css';

const path = window.location.pathname.replace(/\/+$/, '');
const Page = path === '/host' ? Host : path === '/admin' ? Admin : Play;

createRoot(document.getElementById('root')).render(<Page />);
