import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { Menu, X, ArrowUpRight } from 'lucide-react';
const links = [['Home','/'],['About','/#about'],['Event Details','/details'],['Timeline','/timeline'],['Entry Pass','/entry'],['Guidelines','/guidelines'],['Dress Code','/dress-code'],['Contact','/#contact']];
export default function Layout(){
 const [open,setOpen]=useState(false);
 return <><header className="navbar"><Link className="brand" to="/">GLITCH<span>’26</span><i>✦</i></Link><button className="menu-btn" onClick={()=>setOpen(!open)} aria-label="Toggle menu">{open?<X/>:<Menu/>}</button><nav className={open?'nav-links show':'nav-links'}>{links.map(([n,p])=><NavLink key={n} to={p} onClick={()=>setOpen(false)} className={({isActive})=>isActive?'active':''}>{n}</NavLink>)}<Link className="admin-link" to="/admin">ADMIN <ArrowUpRight size={14}/></Link></nav></header><main><Outlet/></main><footer className="footer"><div><div className="brand">GLITCH<span>’26</span></div><p>A New Era Begins. A New Connection Glitches In.</p><small>Organized by the Department of Information Technology and Management.</small></div><div className="footer-right"><span>Designed with Innovation.</span><span>Celebrated with Passion.</span><small>© 2026 GLITCH’26 · ITM Department</small></div></footer></>
}
