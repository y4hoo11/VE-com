from glob import glob

from setuptools import find_packages, setup

package_name = 'agv_vision'

setup(
    name=package_name,
    version='0.1.0',
    packages=find_packages(exclude=['test']),
    data_files=[
        ('share/ament_index/resource_index/packages',
            ['resource/' + package_name]),
        ('share/' + package_name, ['package.xml']),
        ('share/' + package_name + '/config', glob('config/*.yaml')),
    ],
    install_requires=['setuptools'],
    zip_safe=True,
    maintainer='VE-com team',
    maintainer_email='user@todo.todo',
    description='AGV vision (ArUco marker relocalization)',
    license='Apache-2.0',
    tests_require=['pytest'],
    entry_points={
        'console_scripts': [
            'marker_localizer = agv_vision.marker_localizer:main',
            'make_markers = agv_vision.make_markers:main',
            'calibrate_camera = agv_vision.calibrate_camera:main',
            'grab_frames = agv_vision.grab_frames:main',
        ],
    },
)
