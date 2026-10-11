# The bias and dark steps of IRAF_tutorial_1.pdf; the M67 folder's files carry the same names.
noao
imred
ccdred

ls AutosaveImage-000[1-5]bias.fits > Bias1.list
ls AutosaveImage-000[6-9]bias.fits AutosaveImage-0010bias.fits > Bias2.list
zerocomb @Bias1.list out=Zero1 combine=median reject=none ccdtype="" scale=none rdnoise=15 gain=1.4
zerocomb @Bias2.list out=Zero2 combine=median reject=none ccdtype="" scale=none rdnoise=15 gain=1.4
zerocomb Zero1,Zero2 out=Zero combine=average reject=none ccdtype="" scale=none rdnoise=15 gain=1.4

ls AutosaveImage-000[1-5]dark15.fits > Dark15-1.list
ls AutosaveImage-000[6-9]dark15.fits AutosaveImage-0010dark15.fits > Dark15-2.list
ls AutosaveImage-000[1-5]dark30.fits > Dark30-1.list
ls AutosaveImage-000[6-9]dark30.fits AutosaveImage-0010dark30.fits > Dark30-2.list
ls AutosaveImage-000[1-5]dark60.fits > Dark60-1.list
ls AutosaveImage-000[6-9]dark60.fits AutosaveImage-0010dark60.fits > Dark60-2.list
ls AutosaveImage-000[1-5]dark90.fits > Dark90-1.list
ls AutosaveImage-000[6-9]dark90.fits AutosaveImage-0010dark90.fits > Dark90-2.list

ccdproc.zerocor = yes
ccdproc.darkcor = no
ccdproc.flatcor = no
ccdproc.trim = no
ccdproc.fixpix = no
ccdproc.zero = "Zero.fits"
ccdproc.oversca = no

darkc @Dark15-1.list out=Dark15-1 combine=median reject=none ccdtype="" process=yes scale=exposure rdnoise=15 gain=1.4
darkc @Dark15-2.list out=Dark15-2 combine=median reject=none ccdtype="" process=yes scale=exposure rdnoise=15 gain=1.4
darkc @Dark30-1.list out=Dark30-1 combine=median reject=none ccdtype="" process=yes scale=exposure rdnoise=15 gain=1.4
darkc @Dark30-2.list out=Dark30-2 combine=median reject=none ccdtype="" process=yes scale=exposure rdnoise=15 gain=1.4
darkc @Dark60-1.list out=Dark60-1 combine=median reject=none ccdtype="" process=yes scale=exposure rdnoise=15 gain=1.4
darkc @Dark60-2.list out=Dark60-2 combine=median reject=none ccdtype="" process=yes scale=exposure rdnoise=15 gain=1.4
darkc @Dark90-1.list out=Dark90-1 combine=median reject=none ccdtype="" process=yes scale=exposure rdnoise=15 gain=1.4
darkc @Dark90-2.list out=Dark90-2 combine=median reject=none ccdtype="" process=yes scale=exposure rdnoise=15 gain=1.4

darkc Dark15-1,Dark15-2 out=Dark15 combine=average reject=none ccdtype="" process=no scale=exposure rdnoise=15 gain=1.4
darkc Dark30-1,Dark30-2 out=Dark30 combine=average reject=none ccdtype="" process=no scale=exposure rdnoise=15 gain=1.4
darkc Dark60-1,Dark60-2 out=Dark60 combine=average reject=none ccdtype="" process=no scale=exposure rdnoise=15 gain=1.4
darkc Dark90-1,Dark90-2 out=Dark90 combine=average reject=none ccdtype="" process=no scale=exposure rdnoise=15 gain=1.4
