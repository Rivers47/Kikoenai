import MainLayout from 'layouts/MainLayout'
import DashboardLayout from 'layouts/DashboardLayout'

import Works from 'pages/Works'
import Work from 'pages/Work'
import List from 'pages/List'
import Login from 'pages/Login'
import History from 'pages/History'
import TextViewer from 'pages/TextViewer'
import Downloads from 'pages/Downloads'
import Settings from 'pages/Settings'

import Folders from 'pages/Dashboard/Folders'
import Scanner from 'pages/Dashboard/Scanner'
import Advanced from 'pages/Dashboard/Advanced'
import UserManage from 'pages/Dashboard/UserManage'

const routes = [
  {
    path: '/admin',
    component: DashboardLayout,
    children: [
      {
        path: '',
        component: Folders
      },
      {
        path: 'scanner',
        component: Scanner
      },
      {
        path: 'advanced',
        component: Advanced
      },
      {
        path: 'usermanage',
        component: UserManage
      },
      {
        path: 'settings',
        redirect: '/settings'
      }
    ]
  },
  {
    path: '/',
    component: MainLayout,
    children: [
      {
        path: '',
        name: 'works',
        component: Works
      },
      // Redirect old /works path to / for backwards compatibility
      // (prevents a replaceState loop that breaks popstate on back navigation)
      {
        path: 'works',
        redirect: to => ({ path: '/', query: to.query })
      },
      {
        path: 'work/:id',
        component: Work
      },
      {
        path: 'circles',
        props: { restrict: "circles" },
        component: List
      },
      {
        path: 'tags',
        props: { restrict: "tags" },
        component: List
      },
      {
        path: 'vas',
        props: { restrict: "vas" },
        component: List
      },
      {
        // trackId is `${workId}/${index}`, so the param has to span the slash
        path: 'text/:trackId(.*)',
        component: TextViewer
      },
      {
        path: 'downloads',
        component: Downloads
      },
      {
        path: 'settings',
        component: Settings
      },
      {
        path: 'history',
        name: 'history',
        component: History
      },
      // The favourites page is now the history list; the review and progress
      // tabs are covered by the library page's filter, so old links land here.
      {
        path: 'favourites/:pathMatch(.*)*',
        redirect: '/history'
      },
    ],
    meta: {
      auth: true
    }
  },
  {
    path: '/login',
    component: Login
  }
]

// Always leave this as last one
 
if (process.env.MODE !== 'ssr') {
  routes.push({
    path: '/:pathMatch(.*)*',
    component: () => import('pages/Error404.vue')
  })
}

export default routes
