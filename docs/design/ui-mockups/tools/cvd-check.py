#!/usr/bin/env python3
"""Prüft Teamfarben-Paletten auf Unterscheidbarkeit (CIEDE2000) unter Normal-, Deuter-, Protan- und Tritan-Sicht
(Machado 2009, Schwere 1,0). Aufruf: python3 docs/design/ui-mockups/tools/cvd-check.py  – Ergebnis siehe ui.md §8.2."""
import math, itertools
def hx(h): h=h.lstrip('#'); return [int(h[i:i+2],16)/255 for i in (0,2,4)]
def lin(c): return c/12.92 if c<=0.04045 else ((c+0.055)/1.055)**2.4
def delin(c):
    c=max(0,min(1,c)); return 12.92*c if c<=0.0031308 else 1.055*c**(1/2.4)-0.055
M={ # Machado 2009 severity 1.0
'deutan':[[0.367322,0.860646,-0.227968],[0.280085,0.672501,0.047413],[-0.011820,0.042940,0.968881]],
'protan':[[0.152286,1.052583,-0.204868],[0.114503,0.786281,0.099216],[-0.003882,-0.048116,1.051998]],
'tritan':[[1.255528,-0.076749,-0.178779],[-0.078411,0.930809,0.147602],[0.004733,0.691367,0.303900]]}
def sim(rgb,k):
    l=[lin(c) for c in rgb]
    if k=='normal': return rgb
    m=M[k]; o=[sum(m[i][j]*l[j] for j in range(3)) for i in range(3)]
    return [delin(c) for c in o]
def lab(rgb):
    r,g,b=[lin(c) for c in rgb]
    X=(0.4124*r+0.3576*g+0.1805*b)/0.95047; Y=(0.2126*r+0.7152*g+0.0722*b); Z=(0.0193*r+0.1192*g+0.9505*b)/1.08883
    f=lambda t: t**(1/3) if t>0.008856 else 7.787*t+16/116
    return (116*f(Y)-16, 500*(f(X)-f(Y)), 200*(f(Y)-f(Z)))
def de(a,b):
    # CIEDE2000
    L1,a1,b1=a;L2,a2,b2=b
    C1=math.hypot(a1,b1);C2=math.hypot(a2,b2);Cb=(C1+C2)/2
    G=0.5*(1-math.sqrt(Cb**7/(Cb**7+25**7)))
    a1p=(1+G)*a1;a2p=(1+G)*a2
    C1p=math.hypot(a1p,b1);C2p=math.hypot(a2p,b2)
    h1p=math.degrees(math.atan2(b1,a1p))%360;h2p=math.degrees(math.atan2(b2,a2p))%360
    dLp=L2-L1;dCp=C2p-C1p
    dh=h2p-h1p
    if C1p*C2p==0: dh=0
    elif dh>180: dh-=360
    elif dh<-180: dh+=360
    dHp=2*math.sqrt(C1p*C2p)*math.sin(math.radians(dh/2))
    Lbp=(L1+L2)/2;Cbp=(C1p+C2p)/2
    if C1p*C2p==0: hbp=h1p+h2p
    elif abs(h1p-h2p)>180: hbp=(h1p+h2p+360)/2
    else: hbp=(h1p+h2p)/2
    T=1-0.17*math.cos(math.radians(hbp-30))+0.24*math.cos(math.radians(2*hbp))+0.32*math.cos(math.radians(3*hbp+6))-0.20*math.cos(math.radians(4*hbp-63))
    dth=30*math.exp(-((hbp-275)/25)**2)
    Rc=2*math.sqrt(Cbp**7/(Cbp**7+25**7))
    Sl=1+0.015*(Lbp-50)**2/math.sqrt(20+(Lbp-50)**2);Sc=1+0.045*Cbp;Sh=1+0.015*Cbp*T
    Rt=-math.sin(math.radians(2*dth))*Rc
    return math.sqrt((dLp/Sl)**2+(dCp/Sc)**2+(dHp/Sh)**2+Rt*(dCp/Sc)*(dHp/Sh))
conds=['normal','deutan','protan','tritan']
for name,final in [('std',{'Rot':'#C8372D','Blau':'#2F6FD0','Gruen':'#3E9A4A','Violett':'#7A4CC2','Cyan':'#27A6B5','Orange':'#E07A1F','Pink':'#D0569A','Oliv':'#8A8F2E'}),('cb',{'Blau':'#0072B2','Orange':'#E69F00','Himmel':'#56B4E9','Blaugruen':'#009E73','Rotviolett':'#CC79A7','Rot':'#D7263D','Purpur':'#AA3377','Rosa':'#EE6677'})]:
  for k in conds:
    ls={n:lab(sim(hx(c),k)) for n,c in final.items()}
    ps=sorted((de(ls[a],ls[b]),a,b) for a,b in itertools.combinations(final,2))
    print(name,k, [(round(p[0],1),p[1],p[2]) for p in ps[:2]], 'Slot1-2:', round(de(ls[list(final)[0]],ls[list(final)[1]]),1))
