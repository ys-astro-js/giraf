# PSF Photometry Instruction (Part #1) (PSF_photometry_1.pdf)
noao.digi
daophot

datapars.fwhmpsf = 7.8
datapars.sigma = 22.
datapars.readnoi = 21.
datapars.epadu = 4.4
datapars.itime = 90.
fitskypars.annulus = 31
fitskypars.dannulu = 27.
fitskypars.skyvalu = 3680.
photpars.aperture = 23.
daopars.psfrad = 50.
daopars.fitrad = 10.

# First PSF Generation (psf)
del NGC2420b.pst.1
del NGC2420b.psg.1
del NGC2420b.psf.1.fits
display NGC2420b.fits 1 fi+
unlearn psf
psf NGC2420b photfile=NGC2420b.mag.1 psfimage=NGC2420b.psf.1 opstfile=NGC2420b.pst.1 groupfile=NGC2420b.psg.1

# Performing Star Subtraction (allstar)
del NGC2420b.sub.1.fits
del NGC2420b.als.1
del NGC2420b.arj.1
allstar NGC2420b photfile=NGC2420b.mag.1 psfimage=NGC2420b.psf.1 allstarf=NGC2420b.als.1 rejfile=NGC2420b.arj.1 subimage=NGC2420b.sub.1
display NGC2420b.sub.1.fits 2 fi+

# Refining the PSF with Subtracted Images (substar & second psf)
del NGC2420b.sub.11.fits
substar NGC2420b photfile=NGC2420b.als.1 exfile=NGC2420b.pst.1 psfimage=NGC2420b.psf.1 subimage=NGC2420b.sub.11
display NGC2420b.sub.11.fits 3 fi+
del NGC2420b.ps?.2*
del NGC2420b.psf.2.fits
psf NGC2420b.sub.11 photfile=NGC2420b.mag.1 pstfile=NGC2420b.pst.1 psfimage=NGC2420b.psf.2 opstfile=NGC2420b.pst.2 groupfile=NGC2420b.psg.2

# Final PSF Visualization (seepsf)
del sNGC2420b.psf.2.fits
seepsf NGC2420b.psf.2 sNGC2420b.psf.2
display sNGC2420b.psf.2 4 fi+
