# IRAF Data Reduction Guide: NGC2420 Processing (IRAF_tutorial_1.pdf)
noao.imred
ccdred

# Step 1: Bias Frame Combination
ls AutosaveImage-000[1-5]bias.fits > Bias1.list
ls AutosaveImage-000[6-9]bias.fits AutosaveImage-0010bias.fits > Bias2.list
zerocomb @Bias1.list out=Zero1 combine=median reject=none ccdtype="" scale=none rdnoise=15 gain=1.4
zerocomb @Bias2.list out=Zero2 combine=median reject=none ccdtype="" scale=none rdnoise=15 gain=1.4
zerocomb Zero1,Zero2 out=Zero combine=average reject=none ccdtype="" scale=none rdnoise=15 gain=1.4

# Step 2: Dark Frame Processing & Combination
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

# Step 3: Flat Field Combination
ccdhedit flat_B_* subset B
ccdhedit flat_V_* subset V
ls flat_*.fits > Flat.list
flatcomb @Flat.list out=Flat combine=median \
reject=avsigclip ccdtype="" process+ subsets+ scale=mean \
statsec=[500:1500,500:1500] rdnoise=15 gain=1.4

# Step 4: Object Processing (NGC2420)
ccdhedit NGC2420_B* subset B
ccdhedit NGC2420_V* subset V
ls NGC2420_B90_*.fits > objB90.list
ls NGC2420_V60_*.fits > objV60.list
# Process B-band (90 s) images using Zero, Dark90, and FlatB
ccdproc @objB90.list out=p@objB90.list ccdtype="" fixpix- oversc- \
trim- zerocor+ darkcor+ flatcor+ zero=Zero dark=Dark90 flat=FlatB.fits
# Process V-band (60 s) images using Zero, Dark60, and FlatV
ccdproc @objV60.list out=p@objV60.list ccdtype="" fixpix- oversc- \
trim- zerocor+ darkcor+ flatcor+ zero=Zero dark=Dark60 flat=FlatV.fits

# Step 5: Image Alignment & Final Stacking
!ds9 pNGC2420* &
ls pNGC2420* > NGC2420.list
ls pNGC2420* > alNGC2420.list
vi alNGC2420.list
imexam.logfile = "NGC2420.cod"
imexam.keeplog = yes
imexam
imexam.keeplog = no
imexam
vi NGC2420.shf
imalign @NGC2420.list reference="pNGC2420_B90_1" coords="NGC2420.cod" output=@alNGC2420.list shifts="NGC2420.shf"
!ds9 alpNGC2420* &
ls alpNGC2420_B* > NGC2420b.list
ls alpNGC2420_V* > NGC2420v.list
imcombine @NGC2420b.list output=NGC2420b combine=median reject=none rdnoise=15 gain=1.4 scale=none zero=mode
imcombine @NGC2420v.list output=NGC2420v combine=median reject=none rdnoise=15 gain=1.4 scale=none zero=mode
